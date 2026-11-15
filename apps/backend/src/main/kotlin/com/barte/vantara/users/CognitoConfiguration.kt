package com.barte.vantara.users

import jakarta.servlet.DispatcherType
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import org.springframework.http.HttpMethod
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
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient
import java.net.URI
import java.time.Duration

@ConfigurationProperties("cognito")
data class CognitoProperties(
    val region: String = "us-east-1",
    val poolId: String = "unconfigured",
    val clientId: String = "unconfigured",
    val mcpClientId: String = "",
    val issuer: String = "https://cognito-idp.us-east-1.amazonaws.com/unconfigured",
    val jwksUri: String = "$issuer/.well-known/jwks.json",
    val endpoint: String = "",
)

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(CognitoProperties::class)
@Profile("!migrate")
class CognitoConfiguration {
    @Bean
    fun cognitoClient(properties: CognitoProperties): CognitoIdentityProviderClient {
        val builder =
            CognitoIdentityProviderClient
                .builder()
                .region(Region.of(properties.region))
                .httpClientBuilder(
                    UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(3)).socketTimeout(Duration.ofSeconds(10)),
                ).overrideConfiguration { it.apiCallTimeout(Duration.ofSeconds(15)) }
        if (properties.endpoint.isNotEmpty()) builder.endpointOverride(URI(properties.endpoint))
        return builder.build()
    }

    @Bean
    @Profile("!seed")
    fun jwtDecoder(properties: CognitoProperties): JwtDecoder =
        NimbusJwtDecoder.withJwkSetUri(properties.jwksUri).build().apply {
            setJwtValidator(
                DelegatingOAuth2TokenValidator(
                    JwtValidators.createDefaultWithIssuer(properties.issuer),
                    OAuth2TokenValidator<Jwt> { token ->
                        val client = token.getClaimAsString("client_id")
                        val clients = setOf(properties.clientId, properties.mcpClientId) - setOf("", "unconfigured")
                        if (token.getClaimAsString("token_use") == "access" &&
                            client in clients &&
                            !token.subject.isNullOrBlank() &&
                            token.expiresAt != null
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
    @Profile("!seed")
    fun security(http: HttpSecurity): SecurityFilterChain {
        http
            .csrf { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it
                    .dispatcherTypeMatchers(DispatcherType.ERROR)
                    .permitAll()
                    .requestMatchers(HttpMethod.POST, "/api/signin", "/api/signin/password")
                    .permitAll()
                    .requestMatchers(HttpMethod.GET, "/api/health", "/api/health/**", "/api/hello", "/api/tenants")
                    .permitAll()
                    .anyRequest()
                    .authenticated()
            }.oauth2ResourceServer { it.jwt {} }
        return http.build()
    }
}
