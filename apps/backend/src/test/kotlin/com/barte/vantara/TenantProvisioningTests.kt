package com.barte.vantara

import com.barte.vantara.tenants.ProvisionTenantRequest
import com.barte.vantara.tenants.TenantController
import com.barte.vantara.tenants.TenantRegistration
import com.barte.vantara.users.CognitoProperties
import com.barte.vantara.users.CognitoUsers
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.anyString
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.server.ResponseStatusException
import org.testcontainers.postgresql.PostgreSQLContainer
import java.util.UUID

class TenantProvisioningTests {
    @Test
    fun `registration is atomic public branding is readable and runtime writes require trusted context`() {
        PostgreSQLContainer("postgres:17-alpine").use { database ->
            database.start()
            Flyway
                .configure()
                .dataSource(database.jdbcUrl, database.username, database.password)
                .placeholders(mapOf("appPassword" to "testRuntimePassword"))
                .load()
                .migrate()
            val owner = JdbcTemplate(DriverManagerDataSource(database.jdbcUrl, database.username, database.password))
            val source = DriverManagerDataSource(database.jdbcUrl, "app_user", "testRuntimePassword")
            val runtime = JdbcTemplate(source)
            val transactions = TransactionTemplate(DataSourceTransactionManager(source))
            val identity = mock(CognitoUsers::class.java)
            `when`(identity.invite(anyString())).thenReturn("subject")
            val controller = TenantController(runtime, transactions, identity, CognitoProperties(issuer = "https://issuer.test"))
            val jwt =
                Jwt
                    .withTokenValue("verified")
                    .header("alg", "RS256")
                    .subject("automation")
                    .build()
            val tenant = TenantRegistration(UUID.randomUUID(), "acme", "Acme", "#112233", setOf("acme.test"))
            val input = ProvisionTenantRequest(tenant, "ADMIN@example.com")
            assertEquals(emptyList<TenantRegistration>(), controller.list().body)
            assertEquals(HttpStatus.CREATED, controller.create(jwt, input).statusCode)
            verify(identity).invite("admin@example.com")
            assertEquals(listOf(tenant), controller.list().body)
            assertEquals(
                1,
                owner.queryForObject(
                    "SELECT count(*) FROM finance.member_role WHERE tenant_id = ? AND role = 'admin'",
                    Int::class.java,
                    tenant.id,
                ),
            )
            assertEquals(0, runtime.queryForObject("SELECT count(*) FROM finance.membership", Int::class.java))
            assertEquals(
                0,
                runtime.queryForObject(
                    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='platform' AND c.relkind='r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)",
                    Int::class.java,
                ),
            )
            for (sql in listOf(
                "DELETE FROM platform.tenant_registration",
                "INSERT INTO platform.tenant_domain VALUES ('evil.test', '${tenant.id}')",
                "SET ROLE platform_guard",
                "SELECT platform.register_tenant('${UUID.randomUUID()}', 'bad', 'Bad', '#112233', '[]'::jsonb, 'issuer', 'subject', 'email')",
            )) {
                assertThrows(DataAccessException::class.java) { runtime.execute(sql) }
            }
            for (collision in listOf(tenant, tenant.copy(id = UUID.randomUUID()), tenant.copy(id = UUID.randomUUID(), slug = "other"))) {
                assertEquals(
                    HttpStatus.CONFLICT,
                    assertThrows(ResponseStatusException::class.java) {
                        controller.create(jwt, input.copy(tenant = collision))
                    }.statusCode,
                )
            }
            for (domain in listOf("invalid/path", "a".repeat(254))) {
                assertEquals(
                    HttpStatus.BAD_REQUEST,
                    assertThrows(ResponseStatusException::class.java) {
                        controller.create(jwt, input.copy(tenant = tenant.copy(domains = setOf(domain))))
                    }.statusCode,
                )
            }
            val failed = tenant.copy(id = UUID.randomUUID(), slug = "failed", domains = setOf("failed.test"))
            owner.update("INSERT INTO finance.tenant VALUES (?, 'Existing unregistered tenant')", failed.id)
            val failure = assertThrows(DataAccessException::class.java) { controller.create(jwt, input.copy(tenant = failed)) }
            verify(identity).compensate("admin@example.com", failure)
            assertEquals(listOf(tenant), controller.list().body)
            `when`(identity.invite("unavailable@example.com")).thenThrow(IllegalStateException("offline"))
            assertThrows(IllegalStateException::class.java) {
                controller.create(jwt, input.copy(tenant = failed.copy(id = UUID.randomUUID()), firstUserEmail = "unavailable@example.com"))
            }
        }
    }
}
