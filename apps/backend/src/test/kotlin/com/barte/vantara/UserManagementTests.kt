package com.barte.vantara

import com.barte.vantara.users.CognitoProperties
import com.barte.vantara.users.DevelopmentSeed
import com.barte.vantara.users.UserAccess
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
import org.testcontainers.containers.wait.strategy.Wait
import org.testcontainers.postgresql.PostgreSQLContainer
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.util.Properties
import java.util.UUID

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UserManagementTests {
    @Autowired
    private lateinit var access: UserAccess

    @Autowired
    private lateinit var decoder: JwtDecoder

    @Autowired
    private lateinit var runtime: JdbcTemplate

    @Value("\${local.server.port}")
    private var port = 0
    private val http = HttpClient.newHttpClient()
    private val json = JsonMapper.builder().build()

    @Test
    fun `tenant branding is public but provisioning never accepts tenant administrator tokens`() {
        assertEquals(200, request("GET", "/tenants").statusCode())
        for (token in listOf(null, login())) {
            assertEquals(401, request("GET", "/admin/tenants", token).statusCode())
            assertEquals(401, request("POST", "/admin/tenants", token, "{}").statusCode())
        }
        assertEquals(400, request("POST", "/signin/password", body = "{}").statusCode())
    }

    @Test
    fun `OIDC origin reaches PostgreSQL approval checks and ambiguous tenant identities fail closed`() {
        val id = owner.queryForObject("SELECT id FROM finance.membership WHERE email = 'ap@vantara.com.br'", UUID::class.java)!!
        owner.update("INSERT INTO finance.approval_scope VALUES (?, ?, ?, 'approve_payable')", tenant, id, unit)
        try {
            for ((client, human) in listOf(config.getProperty("cognito.client-id") to true, mcpClient to false)) {
                val jwt = decoder.decode(login("ap", client))
                access.transaction(jwt, tenant) { ctx, _ ->
                    assertEquals(
                        human,
                        runtime.queryForObject(
                            "SELECT finance.can_approve(?, ?, 'approve_payable')",
                            Boolean::class.java,
                            ctx.tenantId,
                            unit,
                        ),
                    )
                    true
                }
            }
        } finally {
            owner.update("DELETE FROM finance.approval_scope WHERE member_id = ?", id)
        }
        val otherTenant = UUID.randomUUID()
        val jwt = decoder.decode(login("ap"))
        owner.update("INSERT INTO finance.tenant VALUES (?, 'Other')", otherTenant)
        owner.update(
            "INSERT INTO finance.membership (tenant_id, issuer, subject) VALUES (?, ?, ?)",
            otherTenant,
            jwt.issuer.toString(),
            jwt.subject,
        )
        try {
            assertEquals(403, request("GET", "/me", jwt.tokenValue).statusCode())
            assertEquals(otherTenant.toString(), body(request("GET", "/me", jwt.tokenValue, tenantId = otherTenant))["tenant_id"].asText())
            body(request("GET", "/me", jwt.tokenValue, tenantId = tenant))
        } finally {
            owner.update("UPDATE finance.membership SET active = false WHERE tenant_id = ?", otherTenant)
        }
    }

    @Test
    fun `seed entrypoint runs as one shot and closes successfully`() {
        val path = Files.createTempFile("seed-entrypoint", ".properties")
        try {
            main(
                arrayOf(
                    "--spring.profiles.active=seed",
                    "--spring.datasource.url=${postgres.jdbcUrl}",
                    "--spring.datasource.username=${postgres.username}",
                    "--spring.datasource.password=${postgres.password}",
                    "--cognito.endpoint=$endpoint",
                    "--seed.config-path=$path",
                ),
            )
            assertTrue(Files.size(path) > 0)
        } finally {
            Files.delete(path)
        }
    }

    private fun request(
        method: String,
        path: String,
        token: String? = null,
        body: String? = null,
        tenantId: UUID? = null,
    ): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI("http://localhost:$port/api$path"))
        token?.let { builder.header("Authorization", "Bearer $it") }
        tenantId?.let { builder.header("X-Tenant-Id", it.toString()) }
        if (body != null) builder.header("Content-Type", "application/json")
        return http.send(
            builder.method(method, body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()).build(),
            HttpResponse.BodyHandlers.ofString(),
        )
    }

    private fun body(
        response: HttpResponse<String>,
        status: Int = 200,
    ): JsonNode {
        assertEquals(status, response.statusCode(), response.body())
        return json.readTree(response.body())
    }

    private fun login(
        role: String = "admin",
        client: String = config.getProperty("cognito.client-id"),
    ): String =
        cognito
            .initiateAuth {
                it.clientId(client).authFlow("USER_PASSWORD_AUTH").authParameters(
                    mapOf(
                        "USERNAME" to "$role@vantara.com.br",
                        "PASSWORD" to "@Test123",
                    ),
                )
            }.authenticationResult()
            .accessToken()

    @Test
    fun `development seed is repeatable and creates only tenant users and role grants`() {
        assertEquals(listOf(1, 6, 6, 0, 0, 0), seedCounts)
        assertEquals(
            "#175C4C",
            owner.queryForObject("SELECT primary_color FROM platform.tenant_registration WHERE id = ?", String::class.java, tenant),
        )
        assertEquals(
            listOf("vantara.com.br", "vantara.localhost"),
            owner.queryForList("SELECT domain FROM platform.tenant_domain WHERE tenant_id = ? ORDER BY domain", String::class.java, tenant),
        )
        assertEquals(
            6,
            cognito
                .listUsers {
                    it.userPoolId(config.getProperty("cognito.pool-id"))
                }.users()
                .count { user -> user.attributes().any { it.name() == "email" && it.value().endsWith("@vantara.com.br") } },
        )
        for (role in roles) {
            val me = body(request("GET", "/me", login(role)))
            assertEquals("$role@vantara.com.br", me["email"].asText())
            assertEquals(role, me["roles"][0].asText())
            assertEquals(0, me["approvalScopes"].size())
        }
    }

    @Test
    fun `custom local seed creates usable administrator and preserves existing branding on rerun`() {
        val id = UUID.randomUUID()
        val slug = "local-${id.toString().take(8)}"
        val email = "admin@$slug.test"
        val path = Files.createTempFile("tenant-seed", ".properties")
        val args =
            arrayOf(
                "--spring.profiles.active=seed",
                "--spring.datasource.url=${postgres.jdbcUrl}",
                "--spring.datasource.username=${postgres.username}",
                "--spring.datasource.password=${postgres.password}",
                "--cognito.endpoint=$endpoint",
                "--seed.config-path=$path",
                "--seed.tenant-id=$id",
                "--seed.tenant-slug=$slug",
                "--seed.tenant-name=Local tenant",
                "--seed.tenant-primary=#112233",
                "--seed.tenant-domains=$slug.localhost, portal.$slug.test",
                "--seed.admin-email=$email",
            )
        try {
            main(args)
            owner.update("UPDATE platform.tenant_registration SET name = 'Edited', primary_color = '#AABBCC' WHERE id = ?", id)
            main(args)
            assertEquals(
                "Edited",
                owner.queryForObject("SELECT name FROM platform.tenant_registration WHERE id = ?", String::class.java, id),
            )
            assertEquals(
                "#AABBCC",
                owner.queryForObject("SELECT primary_color FROM platform.tenant_registration WHERE id = ?", String::class.java, id),
            )
            assertEquals(2, owner.queryForObject("SELECT count(*) FROM platform.tenant_domain WHERE tenant_id = ?", Int::class.java, id))
            assertEquals(1, owner.queryForObject("SELECT count(*) FROM finance.membership WHERE tenant_id = ?", Int::class.java, id))
            val signin = request("POST", "/signin", body = """{"email":"$email","password":"@Test123"}""")
            val token = body(signin)["accessToken"].asText()
            assertEquals("admin", body(request("GET", "/me", token, tenantId = id))["roles"][0].asText())
            assertEquals(403, request("GET", "/me", token, tenantId = tenant).statusCode())
            val conflict = UUID.randomUUID()
            assertThrows(org.springframework.dao.DataAccessException::class.java) {
                DevelopmentSeed(
                    cognito,
                    owner,
                    CognitoProperties(endpoint = endpoint),
                    path.toString(),
                    conflict.toString(),
                    "conflict",
                    "Conflict",
                    "#112233",
                    "$slug.localhost",
                    "unused@local.test",
                ).run()
            }
            assertEquals(0, owner.queryForObject("SELECT count(*) FROM finance.tenant WHERE id = ?", Int::class.java, conflict))
        } finally {
            Files.deleteIfExists(path)
        }
    }

    @Test
    fun `signin authenticates against Floci and does not cache or expose failures`() {
        val response = request("POST", "/signin", body = """{"email":"admin@vantara.com.br","password":"@Test123"}""")
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElse(""))
        val token = body(response)["accessToken"].asText()
        body(request("GET", "/me", token))
        assertEquals(401, request("POST", "/signin", body = """{"email":"admin@vantara.com.br","password":"wrong"}""").statusCode())
        assertEquals(401, request("POST", "/signin", body = """{"email":"missing@vantara.com.br","password":"wrong"}""").statusCode())
        assertEquals(400, request("POST", "/signin", body = """{"email":"bad","password":""}""").statusCode())
        assertEquals(401, request("GET", "/me").statusCode())
        assertEquals(401, request("POST", "/users", body = "{}").statusCode())
        assertEquals(401, request("GET", "/users").statusCode())
        assertEquals(401, request("GET", "/me", "invalid").statusCode())
        assertEquals("Invalid request", body(request("POST", "/signin", body = "{bad json"), 400)["error"].asText())
    }

    @Test
    fun `all management routes require admin for every role`() {
        val admin = login()
        assertEquals(6, body(request("GET", "/users/roles", admin)).size())
        val id = body(request("GET", "/me", admin))["id"].asText()
        for (role in roles - "admin") {
            val token = login(role)
            for ((method, path, payload) in listOf(
                Triple("GET", "/users", null),
                Triple("GET", "/users/roles", null),
                Triple("GET", "/users/$id", null),
                Triple("POST", "/users", """{"email":"unused@example.com","password":"@Test123","roles":["ap"]}"""),
                Triple("PATCH", "/users/$id", "{}"),
                Triple("DELETE", "/users/$id", null),
            )) {
                assertEquals(403, request(method, path, token, payload).statusCode(), "$role $method $path")
            }
        }
    }

    @Test
    fun `admin manages users and deactivation immediately invalidates existing tokens`() {
        val admin = login()
        val email = "${UUID.randomUUID()}@example.com"
        val created =
            body(
                request(
                    "POST",
                    "/users",
                    admin,
                    """{"email":"$email","password":"@Test123","displayName":"Example","roles":["ap"],"unitIds":["$unit"],"bankAccountIds":["$account"]}""",
                ),
                201,
            )
        val id = created["id"].asText()
        val token =
            cognito
                .initiateAuth {
                    it.clientId(config.getProperty("cognito.client-id")).authFlow("USER_PASSWORD_AUTH").authParameters(
                        mapOf(
                            "USERNAME" to email,
                            "PASSWORD" to "@Test123",
                        ),
                    )
                }.authenticationResult()
                .accessToken()
        assertEquals("Example", body(request("GET", "/users/$id", admin))["display_name"].asText())
        body(request("GET", "/me", token))
        val patched =
            body(
                request(
                    "PATCH",
                    "/users/$id",
                    admin,
                    """{"displayName":"Renamed","roles":["ar"],"active":true,"unitIds":["$unit"],"bankAccountIds":[]}""",
                ),
            )
        assertEquals("ar", patched["roles"][0].asText())
        assertEquals("Renamed", patched["display_name"].asText())
        body(request("PATCH", "/users/$id", admin, "{}"))
        assertEquals(1, body(request("GET", "/users?limit=1&offset=0", admin)).size())
        assertEquals(0, body(request("GET", "/users?offset=10000", admin)).size())
        assertEquals(400, request("GET", "/users?offset=-1", admin).statusCode())
        assertEquals(400, request("GET", "/users?limit=101", admin).statusCode())
        assertEquals(400, request("GET", "/users?limit=0", admin).statusCode())
        assertEquals(204, request("DELETE", "/users/$id", admin).statusCode())
        assertEquals(403, request("GET", "/me", token).statusCode())
        assertFalse(body(request("GET", "/users/$id", admin))["active"].asBoolean())
        body(request("PATCH", "/users/$id", admin, """{"active":true,"unitIds":[],"roles":["fpa"]}"""))
        assertEquals(0, body(request("GET", "/me", token))["unitIds"].size())
        assertEquals(409, request("POST", "/users", admin, """{"email":"$email","password":"@Test123","roles":["ap"]}""").statusCode())
    }

    @Test
    fun `tenant unit and account boundaries prevent escalation and clean up failed Cognito creation`() {
        val admin = login()
        val me = body(request("GET", "/me", admin))
        val own = me["id"].asText()
        assertEquals(403, request("PATCH", "/users/$own", admin, """{"roles":["ap"]}""").statusCode())
        assertEquals(403, request("DELETE", "/users/$own", admin).statusCode())
        assertEquals(404, request("GET", "/users/${UUID.randomUUID()}", admin).statusCode())
        assertEquals(403, request("GET", "/me", admin, tenantId = UUID.randomUUID()).statusCode())
        body(request("GET", "/me", admin, tenantId = tenant))
        assertEquals(400, request("POST", "/users", admin, """{"email":"bad","password":"x","roles":[]}""").statusCode())
        assertEquals(
            400,
            request("POST", "/users", admin, """{"email":"bad@example.com","password":"@Test123","roles":["root"]}""").statusCode(),
        )
        for (scope in listOf("\"unitIds\":[\"$otherUnit\"]", "\"bankAccountIds\":[\"${UUID.randomUUID()}\"]")) {
            val email = "${UUID.randomUUID()}@example.com"
            assertEquals(
                403,
                request("POST", "/users", admin, """{"email":"$email","password":"@Test123","roles":["ar"],$scope}""").statusCode(),
            )
            assertFalse(cognito.listUsers { it.userPoolId(config.getProperty("cognito.pool-id")) }.users().any { it.username() == email })
            assertEquals(0, owner.queryForObject("SELECT count(*) FROM finance.membership WHERE email = ?", Int::class.java, email))
        }
        val restricted = UUID.randomUUID()
        owner.update(
            "INSERT INTO finance.membership (tenant_id, id, issuer, subject) VALUES (?, ?, ?, ?)",
            tenant,
            restricted,
            config.getProperty("cognito.issuer"),
            restricted.toString(),
        )
        owner.update("INSERT INTO finance.member_unit VALUES (?, ?, ?)", tenant, restricted, otherUnit)
        assertEquals(404, request("GET", "/users/$restricted", admin).statusCode())
        assertEquals(404, request("PATCH", "/users/$restricted", admin, "{}").statusCode())
        assertEquals(404, request("DELETE", "/users/$restricted", admin).statusCode())
    }

    @Test
    fun `delegated OIDC uses same membership with AI origin and rejects ID or unrelated client tokens`() {
        val delegated = body(request("GET", "/me", login("ap", mcpClient)))
        assertEquals("ai", delegated["actorKind"].asText())
        assertEquals("ap", delegated["roles"][0].asText())
        assertEquals(0, delegated["approvalScopes"].size())
        assertEquals(403, request("GET", "/users", login("ap", mcpClient)).statusCode())
        val result =
            cognito
                .initiateAuth {
                    it.clientId(config.getProperty("cognito.client-id")).authFlow("USER_PASSWORD_AUTH").authParameters(
                        mapOf(
                            "USERNAME" to "ap@vantara.com.br",
                            "PASSWORD" to "@Test123",
                        ),
                    )
                }.authenticationResult()
        assertEquals(401, request("GET", "/me", result.idToken()).statusCode())
        assertEquals(401, request("GET", "/me", login("ap", rogueClient)).statusCode())
        val token = result.accessToken()
        assertEquals(401, request("GET", "/me", token.substringBeforeLast('.') + ".AAAAAAAA").statusCode())
    }

    companion object {
        private val roles = listOf("admin", "ap", "ar", "reconciliation", "controllership", "fpa")
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }
        private val floci =
            GenericContainer(
                "floci/floci:2.3.0",
            ).withExposedPorts(4566).waitingFor(Wait.forHttp("/health").forPort(4566)).apply {
                start()
            }
        private val endpoint = "http://${floci.host}:${floci.getMappedPort(4566)}"
        private val cognito =
            CognitoIdentityProviderClient
                .builder()
                .endpointOverride(URI(endpoint))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .build()
        private val owner = JdbcTemplate(DriverManagerDataSource(postgres.jdbcUrl, postgres.username, postgres.password))
        private val config = Properties()
        private val tenant = UUID.fromString("ce19c2fb-b199-4b58-a274-113cd07ce416")
        private val unit = UUID.randomUUID()
        private val otherUnit = UUID.randomUUID()
        private val account = UUID.randomUUID()
        private val seedCounts: List<Int?>
        private val mcpClient: String
        private val rogueClient: String

        init {
            System.setProperty("aws.accessKeyId", "test")
            System.setProperty("aws.secretAccessKey", "test")
            Flyway
                .configure()
                .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
                .placeholders(mapOf("appPassword" to "testRuntimePassword"))
                .load()
                .migrate()
            val path = Files.createTempFile("cognito-test", ".properties")
            val seed = DevelopmentSeed(cognito, owner, CognitoProperties(endpoint = endpoint), path.toString())
            seed.run()
            seed.run()
            Files.newInputStream(path).use(config::load)
            Files.delete(path)
            seedCounts =
                listOf("tenant", "membership", "member_role", "business_unit", "bank_account", "title")
                    .map { owner.queryForObject("SELECT count(*) FROM finance.$it", Int::class.java) }
            owner.update("INSERT INTO finance.business_unit VALUES (?, ?, 'Unit'), (?, ?, 'Other')", tenant, unit, tenant, otherUnit)
            owner.update("INSERT INTO finance.member_unit SELECT tenant_id, id, ? FROM finance.membership", unit)
            owner.update("INSERT INTO finance.bank_account VALUES (?, ?, ?, '341', 'test', 'BRL')", tenant, unit, account)
            owner.update("INSERT INTO finance.member_bank_account SELECT tenant_id, id, ?, ? FROM finance.membership", unit, account)

            fun client(name: String): String =
                cognito
                    .createUserPoolClient {
                        it
                            .userPoolId(
                                config.getProperty("cognito.pool-id"),
                            ).clientName(name)
                            .explicitAuthFlowsWithStrings("ALLOW_USER_PASSWORD_AUTH")
                    }.userPoolClient()
                    .clientId()
            mcpClient = client("test-delegated")
            rogueClient = client("untrusted")
        }

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username") { "app_user" }
            registry.add("spring.datasource.password") { "testRuntimePassword" }
            config.forEach { (key, value) -> registry.add(key.toString()) { value } }
            registry.add("cognito.endpoint") { endpoint }
            registry.add("cognito.mcp-client-id") { mcpClient }
        }
    }
}
