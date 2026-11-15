package com.barte.vantara

import com.barte.vantara.tenants.GithubProvisioningProperties
import com.barte.vantara.tenants.ProvisioningSecurity
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
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.security.oauth2.jwt.JwtException
import java.net.InetSocketAddress
import java.time.Instant
import java.util.Date

class ProvisioningIdentityTests {
    @ParameterizedTest
    @ValueSource(strings = ["org/repo", "org@123/repo@456"])
    fun `GitHub trust rejects missing and mismatched claims expired tokens and disabled repositories`(repository: String) {
        val key = RSAKeyGenerator(2048).keyID("github").generate()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/jwks") { exchange ->
            val bytes = JWKSet(key.toPublicJWK()).toString().toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        try {
            val properties = GithubProvisioningProperties(repository = repository, jwksUri = "http://127.0.0.1:${server.address.port}/jwks")
            val decoder = ProvisioningSecurity().decoder(properties)

            fun token(change: (JWTClaimsSet.Builder) -> Unit = {}): String {
                val claims =
                    JWTClaimsSet
                        .Builder()
                        .issuer("https://token.actions.githubusercontent.com")
                        .subject("repo:$repository:environment:prod-tenants")
                        .audience(properties.audience)
                        .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                        .claim("repository", "org/repo")
                        .claim("ref", properties.ref)
                        .claim("event_name", "workflow_dispatch")
                        .claim("workflow_ref", "org/repo/.github/workflows/provision-tenant.yml@refs/heads/main")
                change(claims)
                return SignedJWT(JWSHeader.Builder(JWSAlgorithm.RS256).keyID("github").build(), claims.build())
                    .apply { sign(RSASSASigner(key)) }
                    .serialize()
            }
            assertEquals("repo:$repository:environment:prod-tenants", decoder.decode(token()).subject)
            assertThrows(JwtException::class.java) {
                decoder.decode(token { it.subject("repo:org@999/repo@456:environment:prod-tenants") })
            }
            for (claim in listOf("iss", "sub", "aud", "repository", "ref", "event_name", "workflow_ref")) {
                for (value in listOf(null, "untrusted")) {
                    assertThrows(JwtException::class.java) { decoder.decode(token { it.claim(claim, value) }) }
                }
            }
            assertThrows(JwtException::class.java) { decoder.decode(token { it.expirationTime(null) }) }
            assertThrows(
                JwtException::class.java,
            ) { decoder.decode(token { it.expirationTime(Date.from(Instant.now().minusSeconds(120))) }) }
            assertThrows(JwtException::class.java) { decoder.decode(token { it.notBeforeTime(Date.from(Instant.now().plusSeconds(120))) }) }
            assertThrows(JwtException::class.java) { decoder.decode(token().substringBeforeLast('.') + ".AAAA") }
            assertThrows(JwtException::class.java) { ProvisioningSecurity().decoder(properties.copy(repository = "")).decode(token()) }
        } finally {
            server.stop(0)
        }
    }
}
