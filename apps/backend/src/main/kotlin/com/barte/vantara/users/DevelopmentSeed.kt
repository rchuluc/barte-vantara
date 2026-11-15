package com.barte.vantara.users

import com.nimbusds.jwt.SignedJWT
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.CommandLineRunner
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionTemplate
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient
import software.amazon.awssdk.services.cognitoidentityprovider.model.ExplicitAuthFlowsType
import software.amazon.awssdk.services.cognitoidentityprovider.model.MessageActionType
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserNotFoundException
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.util.Properties
import java.util.UUID

/** Explicit one-shot local profile; never registered in the production runtime. */
@Component
@Profile("seed")
class DevelopmentSeed(
    private val cognito: CognitoIdentityProviderClient,
    private val jdbc: JdbcTemplate,
    private val config: CognitoProperties,
    @Value("\${seed.config-path:/auth/cognito.properties}") private val configPath: String,
    @Value("\${seed.tenant-id:ce19c2fb-b199-4b58-a274-113cd07ce416}") private val tenantId: String = "ce19c2fb-b199-4b58-a274-113cd07ce416",
    @Value("\${seed.tenant-slug:vantara}") private val tenantSlug: String = "vantara",
    @Value("\${seed.tenant-name:Vantara}") private val tenantName: String = "Vantara",
    @Value("\${seed.tenant-primary:#175C4C}") private val tenantPrimary: String = "#175C4C",
    @Value(
        "\${seed.tenant-domains:vantara.localhost,vantara.com.br}",
    ) private val tenantDomains: String = "vantara.localhost,vantara.com.br",
    @Value("\${seed.admin-email:}") private val adminEmail: String = "",
) : CommandLineRunner {
    override fun run(vararg args: String) {
        require(URI(config.endpoint).host in setOf("floci", "localhost", "127.0.0.1")) { "Seed requires local Floci" }
        val pool =
            cognito
                .listUserPools { it.maxResults(60) }
                .userPools()
                .firstOrNull { it.name() == "vantara-local" }
                ?.id()
                ?: cognito
                    .createUserPool {
                        it
                            .poolName("vantara-local")
                            .usernameAttributesWithStrings("email")
                            .adminCreateUserConfig { a -> a.allowAdminCreateUserOnly(true) }
                            .usernameConfiguration { u -> u.caseSensitive(false) }
                            .policies { p ->
                                p.passwordPolicy { policy ->
                                    policy
                                        .minimumLength(8)
                                        .requireLowercase(true)
                                        .requireUppercase(true)
                                        .requireNumbers(true)
                                        .requireSymbols(true)
                                }
                            }
                    }.userPool()
                    .id()
        val client =
            cognito
                .listUserPoolClients { it.userPoolId(pool).maxResults(60) }
                .userPoolClients()
                .firstOrNull {
                    it.clientName() ==
                        "vantara-local"
                }?.clientId()
                ?: cognito
                    .createUserPoolClient {
                        it
                            .userPoolId(pool)
                            .clientName("vantara-local")
                            .generateSecret(false)
                            .explicitAuthFlows(
                                ExplicitAuthFlowsType.ALLOW_USER_PASSWORD_AUTH,
                                ExplicitAuthFlowsType.ALLOW_REFRESH_TOKEN_AUTH,
                            )
                    }.userPoolClient()
                    .clientId()
        val tenant = UUID.fromString(tenantId)
        TransactionTemplate(DataSourceTransactionManager(jdbc.dataSource!!)).execute {
            jdbc.update("INSERT INTO finance.tenant (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING", tenant, tenantName)
            val inserted =
                jdbc.update(
                    "INSERT INTO platform.tenant_registration (id, slug, name, primary_color) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
                    tenant,
                    tenantSlug,
                    tenantName,
                    tenantPrimary,
                )
            if (inserted == 1) {
                for (domain in tenantDomains.split(',').map(String::trim)) {
                    jdbc.update("INSERT INTO platform.tenant_domain (domain, tenant_id) VALUES (?, ?)", domain, tenant)
                }
            }
        }
        var issuer = ""
        val roles = if (adminEmail.isBlank()) listOf("admin", "ap", "ar", "reconciliation", "controllership", "fpa") else listOf("admin")
        for (role in roles) {
            val email = if (adminEmail.isBlank()) "$role@vantara.com.br" else adminEmail.lowercase()
            val attributes =
                try {
                    cognito.adminGetUser { it.userPoolId(pool).username(email) }.userAttributes()
                } catch (_: UserNotFoundException) {
                    cognito
                        .adminCreateUser {
                            it
                                .userPoolId(pool)
                                .username(email)
                                .temporaryPassword("@Test123")
                                .messageAction(MessageActionType.SUPPRESS)
                                .userAttributes({ a -> a.name("email").value(email) })
                        }.user()
                        .attributes()
                }
            cognito.adminSetUserPassword {
                it
                    .userPoolId(pool)
                    .username(email)
                    .password("@Test123")
                    .permanent(true)
            }
            val token =
                cognito
                    .initiateAuth {
                        it.clientId(client).authFlow("USER_PASSWORD_AUTH").authParameters(
                            mapOf(
                                "USERNAME" to email,
                                "PASSWORD" to "@Test123",
                            ),
                        )
                    }.authenticationResult()
                    .accessToken()
            issuer = SignedJWT.parse(token).jwtClaimsSet.issuer
            val subject = attributes.first { it.name() == "sub" }.value()
            val id =
                jdbc.queryForObject(
                    "INSERT INTO finance.membership (tenant_id, issuer, subject, email, display_name) VALUES (?, ?, ?, ?, ?) " +
                        "ON CONFLICT (tenant_id, issuer, subject) DO UPDATE SET email = EXCLUDED.email RETURNING id",
                    UUID::class.java,
                    tenant,
                    issuer,
                    subject,
                    email,
                    role,
                )!!
            jdbc.update("INSERT INTO finance.member_role VALUES (?, ?, ?) ON CONFLICT DO NOTHING", tenant, id, role)
        }
        val properties =
            Properties().apply {
                setProperty("cognito.pool-id", pool)
                setProperty("cognito.client-id", client)
                setProperty("cognito.issuer", issuer)
                setProperty("cognito.jwks-uri", "${config.endpoint}/$pool/.well-known/jwks.json")
            }
        Files.newOutputStream(Path.of(configPath)).use { properties.store(it, "Local Floci identity configuration; no secrets") }
    }
}
