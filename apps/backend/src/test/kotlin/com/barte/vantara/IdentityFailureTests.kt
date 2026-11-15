package com.barte.vantara

import com.barte.vantara.users.CognitoConfiguration
import com.barte.vantara.users.CognitoProperties
import com.barte.vantara.users.CognitoUsers
import com.barte.vantara.users.DevelopmentSeed
import com.barte.vantara.users.UserErrors
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.RSASSASigner
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.oauth2.jwt.JwtException
import org.springframework.web.server.ResponseStatusException
import software.amazon.awssdk.awscore.exception.AwsErrorDetails
import software.amazon.awssdk.core.exception.SdkClientException
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserResponse
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminDeleteUserRequest
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminSetUserPasswordRequest
import software.amazon.awssdk.services.cognitoidentityprovider.model.CognitoIdentityProviderException
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthRequest
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthResponse
import java.net.InetSocketAddress
import java.sql.SQLException
import java.time.Instant
import java.util.Date
import java.util.function.Consumer

class IdentityFailureTests {
    @Test
    fun `provider and SQL failures map to stable sanitized responses`() {
        val handler = UserErrors()
        val statuses =
            mapOf(
                "NotAuthorizedException" to 401,
                "UserNotFoundException" to 401,
                "UserNotConfirmedException" to 401,
                "PasswordResetRequiredException" to 401,
                "UsernameExistsException" to 409,
                "AliasExistsException" to 409,
                "InvalidPasswordException" to 400,
                "InvalidParameterException" to 400,
                "TooManyRequestsException" to 429,
                "LimitExceededException" to 429,
                "InternalErrorException" to 502,
            )
        for ((code, status) in statuses) {
            val error =
                CognitoIdentityProviderException
                    .builder()
                    .message("sensitive provider detail")
                    .awsErrorDetails(AwsErrorDetails.builder().errorCode(code).build())
                    .build()
            val response = handler.cognito(error)
            assertEquals(status, response.statusCode.value())
            assertEquals(mapOf("error" to HttpStatus.valueOf(status).reasonPhrase), response.body)
        }
        assertEquals(502, handler.cognito(CognitoIdentityProviderException.builder().build()).statusCode.value())
        assertEquals(502, handler.cognito(SdkClientException.create("network error")).statusCode.value())
        for ((state, status) in mapOf("42501" to 403, "23503" to 409, "23505" to 409, "23514" to 400, "08006" to 503)) {
            assertEquals(
                status,
                handler.database(DataAccessResourceFailureException("SQL with secrets", SQLException("detail", state))).statusCode.value(),
            )
        }
        assertEquals(503, handler.database(DataAccessResourceFailureException("no SQL cause")).statusCode.value())
    }

    @Test
    fun `Cognito challenges fail closed and partial provisioning compensates preserving original failure`() {
        val client = mock(CognitoIdentityProviderClient::class.java)
        val service = CognitoUsers(client, CognitoProperties(poolId = "pool", clientId = "client"))
        `when`(
            client.initiateAuth(any<Consumer<InitiateAuthRequest.Builder>>()),
        ).thenReturn(InitiateAuthResponse.builder().challengeName("NEW_PASSWORD_REQUIRED").build())
        assertEquals(
            HttpStatus.UNAUTHORIZED,
            assertThrows(ResponseStatusException::class.java) {
                service.signin("a@example.com", "secret")
            }.statusCode,
        )
        `when`(client.adminCreateUser(any<Consumer<AdminCreateUserRequest.Builder>>())).thenReturn(
            AdminCreateUserResponse
                .builder()
                .user { it.username("created").attributes({ a -> a.name("sub").value("subject") }) }
                .build(),
        )
        val original = SdkClientException.create("password update unavailable")
        doThrow(original).`when`(client).adminSetUserPassword(any<Consumer<AdminSetUserPasswordRequest.Builder>>())
        assertEquals(original, assertThrows(SdkClientException::class.java) { service.create("a@example.com", "secret") })
        verify(client).adminDeleteUser(any<Consumer<AdminDeleteUserRequest.Builder>>())
        doThrow(
            SdkClientException.create("cleanup unavailable"),
        ).`when`(client).adminDeleteUser(any<Consumer<AdminDeleteUserRequest.Builder>>())
        assertEquals(original, assertThrows(SdkClientException::class.java) { service.create("a@example.com", "secret") })
        assertEquals(1, original.suppressed.size)
        val seed =
            DevelopmentSeed(
                client,
                mock(JdbcTemplate::class.java),
                CognitoProperties(endpoint = "https://cognito-idp.us-east-1.amazonaws.com"),
                "unused",
            )
        assertThrows(IllegalArgumentException::class.java) { seed.run() }
    }

    @Test
    fun `JWT validation requires trusted issuer signature expiry access token client and user identity`() {
        val key = RSAKeyGenerator(2048).keyID("test").generate()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/jwks") { exchange ->
            val bytes = JWKSet(key.toPublicJWK()).toString().toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        try {
            val props =
                CognitoProperties(
                    issuer = "https://issuer.example/pool",
                    clientId = "web",
                    mcpClientId = "mcp",
                    jwksUri = "http://127.0.0.1:${server.address.port}/jwks",
                )
            val decoder = CognitoConfiguration().jwtDecoder(props)

            fun token(change: (JWTClaimsSet.Builder) -> Unit = {}): String {
                val claims =
                    JWTClaimsSet
                        .Builder()
                        .issuer(props.issuer)
                        .subject("user")
                        .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                        .issueTime(Date.from(Instant.now()))
                        .claim("client_id", "web")
                        .claim("token_use", "access")
                change(claims)
                return SignedJWT(
                    JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test").build(),
                    claims.build(),
                ).apply { sign(RSASSASigner(key)) }.serialize()
            }
            assertEquals("user", decoder.decode(token()).subject)
            assertEquals("mcp", decoder.decode(token { it.claim("client_id", "mcp") }).getClaimAsString("client_id"))
            val invalid: List<(JWTClaimsSet.Builder) -> Unit> =
                listOf(
                    { it.issuer("https://attacker.example") },
                    { it.claim("token_use", "id") },
                    { it.claim("token_use", null) },
                    { it.claim("client_id", "other") },
                    { it.claim("client_id", null) },
                    { it.subject(null) },
                    { it.subject("") },
                    { it.subject("  ") },
                    { it.expirationTime(null) },
                    { it.expirationTime(Date.from(Instant.now().minusSeconds(120))) },
                    { it.notBeforeTime(Date.from(Instant.now().plusSeconds(120))) },
                )
            invalid.forEach { change -> assertThrows(JwtException::class.java) { decoder.decode(token(change)) } }
            val disabled = CognitoConfiguration().jwtDecoder(props.copy(clientId = "unconfigured", mcpClientId = ""))
            assertThrows(JwtException::class.java) { disabled.decode(token { it.claim("client_id", "unconfigured") }) }
        } finally {
            server.stop(0)
        }
    }
}
