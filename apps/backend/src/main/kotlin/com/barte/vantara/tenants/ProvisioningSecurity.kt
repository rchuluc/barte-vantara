package com.barte.vantara.tenants

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.core.annotation.Order
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator
import org.springframework.security.oauth2.core.OAuth2Error
import org.springframework.security.oauth2.core.OAuth2TokenValidator
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.security.oauth2.jwt.JwtValidators
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.security.web.SecurityFilterChain

@ConfigurationProperties("provisioning.github")
data class GithubProvisioningProperties(
    val repository: String = "",
    val environment: String = "prod-tenants",
    val ref: String = "refs/heads/main",
    val audience: String = "vantara-tenant-provisioning",
    val jwksUri: String = "https://token.actions.githubusercontent.com/.well-known/jwks",
)

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(GithubProvisioningProperties::class)
@Profile("!migrate & !seed")
class ProvisioningSecurity {
    fun decoder(properties: GithubProvisioningProperties): JwtDecoder =
        NimbusJwtDecoder.withJwkSetUri(properties.jwksUri).build().apply {
            val repositoryName = properties.repository.replace(Regex("@[0-9]+(?=/|$)"), "")
            setJwtValidator(
                DelegatingOAuth2TokenValidator(
                    JwtValidators.createDefaultWithIssuer("https://token.actions.githubusercontent.com"),
                    OAuth2TokenValidator<Jwt> { token ->
                        val expected =
                            mapOf(
                                "repository" to repositoryName,
                                "ref" to properties.ref,
                                "event_name" to "workflow_dispatch",
                                "workflow_ref" to "$repositoryName/.github/workflows/provision-tenant.yml@${properties.ref}",
                                "sub" to "repo:${properties.repository}:environment:${properties.environment}",
                            )
                        if (properties.repository.isNotBlank() &&
                            token.expiresAt != null &&
                            token.audience?.contains(properties.audience) == true &&
                            expected.all { (key, value) -> token.getClaimAsString(key) == value }
                        ) {
                            OAuth2TokenValidatorResult.success()
                        } else {
                            OAuth2TokenValidatorResult.failure(OAuth2Error("invalid_token"))
                        }
                    },
                ),
            )
        }

    @Bean
    @Order(1)
    fun provisioningFilterChain(
        http: HttpSecurity,
        properties: GithubProvisioningProperties,
    ): SecurityFilterChain {
        http
            .securityMatcher("/api/admin/tenants", "/api/admin/tenants/**")
            .csrf { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests { it.anyRequest().authenticated() }
            .oauth2ResourceServer { it.jwt { jwt -> jwt.decoder(decoder(properties)) } }
        return http.build()
    }
}
