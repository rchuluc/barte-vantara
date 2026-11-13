package com.barte.vantara

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.DockerClientFactory
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.sql.DriverManager
import java.sql.SQLException

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BackendApplicationTests {
    @Value("\${local.server.port}")
    private var port: Int = 0

    @Test
    fun `HTTP greeting comes from postgres and readiness includes database`() {
        val client = HttpClient.newHttpClient()
        val greeting =
            client.send(
                HttpRequest.newBuilder(URI("http://localhost:$port/api/hello")).build(),
                HttpResponse.BodyHandlers.ofString(),
            )
        assertEquals(200, greeting.statusCode())
        assertTrue(greeting.body().contains("Hello world from Kotlin and PostgreSQL"))
        val health =
            client.send(
                HttpRequest.newBuilder(URI("http://localhost:$port/api/health")).build(),
                HttpResponse.BodyHandlers.ofString(),
            )
        assertEquals(200, health.statusCode())
        assertTrue(health.body().contains("UP"))
    }

    @Test
    fun `health returns unavailable when postgres is unreachable while liveness stays up`() {
        val docker = DockerClientFactory.instance().client()
        val client = HttpClient.newHttpClient()

        docker.pauseContainerCmd(postgres.containerId).exec()

        try {
            val health =
                client.send(
                    HttpRequest
                        .newBuilder(URI("http://localhost:$port/api/health"))
                        .timeout(java.time.Duration.ofSeconds(10))
                        .build(),
                    HttpResponse.BodyHandlers.ofString(),
                )
            assertEquals(503, health.statusCode())
            assertTrue(health.body().contains("\"status\":\"DOWN\""))
            assertTrue(!health.body().contains("\"components\""))

            val liveness =
                client.send(
                    HttpRequest.newBuilder(URI("http://localhost:$port/api/health/liveness")).build(),
                    HttpResponse.BodyHandlers.ofString(),
                )
            assertEquals(200, liveness.statusCode())
        } finally {
            docker.unpauseContainerCmd(postgres.containerId).exec()
        }
    }

    @Test
    fun `runtime cannot write or read migration history`() {
        DriverManager.getConnection(postgres.jdbcUrl, "app_user", "testRuntimePassword").use { connection ->
            assertThrows(SQLException::class.java) { connection.createStatement().execute("INSERT INTO greetings VALUES (2, 'denied')") }
            assertThrows(SQLException::class.java) { connection.createStatement().executeQuery("SELECT * FROM flyway_schema_history") }
        }
    }

    @Test
    fun `RLS denies writes even if table permission is accidentally granted`() {
        DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { admin ->
            admin.createStatement().execute("GRANT INSERT ON greetings TO app_user")
            try {
                DriverManager.getConnection(postgres.jdbcUrl, "app_user", "testRuntimePassword").use { connection ->
                    val error =
                        assertThrows(
                            SQLException::class.java,
                        ) { connection.createStatement().execute("INSERT INTO greetings VALUES (2, 'denied')") }
                    assertTrue(error.message!!.contains("row-level security"))
                }
            } finally {
                admin.createStatement().execute("REVOKE INSERT ON greetings FROM app_user")
            }
        }
    }

    @Test
    fun `all public tables force RLS and runtime cannot bypass it`() {
        DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
            connection
                .createStatement()
                .executeQuery(
                    "SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname=t.schemaname WHERE t.schemaname='public' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)",
                ).use {
                    it.next()
                    assertEquals(0, it.getInt(1))
                }
            connection.createStatement().executeQuery("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='app_user'").use {
                it.next()
                assertEquals(false, it.getBoolean(1))
            }
        }
    }

    companion object {
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }

        init {
            Flyway
                .configure()
                .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
                .placeholders(mapOf("appPassword" to "testRuntimePassword"))
                .load()
                .migrate()
        }

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.hikari.connection-timeout") { "2000" }
            registry.add("spring.datasource.hikari.validation-timeout") { "1000" }
            registry.add("spring.datasource.hikari.data-source-properties.socketTimeout") { "2" }
            registry.add("spring.datasource.hikari.data-source-properties.connectTimeout") { "2" }
            registry.add("spring.datasource.username") { "app_user" }
            registry.add("spring.datasource.password") { "testRuntimePassword" }
        }
    }
}
