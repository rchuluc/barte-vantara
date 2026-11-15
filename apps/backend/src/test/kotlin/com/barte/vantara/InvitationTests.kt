package com.barte.vantara

import com.barte.vantara.users.CognitoProperties
import com.barte.vantara.users.CognitoUsers
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doReturn
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.web.server.ResponseStatusException
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserResponse
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthRequest
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthResponse
import software.amazon.awssdk.services.cognitoidentityprovider.model.RespondToAuthChallengeRequest
import software.amazon.awssdk.services.cognitoidentityprovider.model.RespondToAuthChallengeResponse
import java.util.function.Consumer

class InvitationTests {
    @Test
    fun `Cognito generates emailed invitations and completes temporary password challenges`() {
        val client = mock(CognitoIdentityProviderClient::class.java)
        val service = CognitoUsers(client, CognitoProperties(poolId = "pool", clientId = "client"))
        `when`(client.adminCreateUser(any<Consumer<AdminCreateUserRequest.Builder>>())).thenAnswer { invocation ->
            val builder = AdminCreateUserRequest.builder()
            invocation.getArgument<Consumer<AdminCreateUserRequest.Builder>>(0).accept(builder)
            val request = builder.build()
            assertEquals("pool", request.userPoolId())
            assertEquals("admin@example.com", request.username())
            assertEquals(listOf("EMAIL"), request.desiredDeliveryMediumsAsStrings())
            assertNull(request.temporaryPassword())
            assertNull(request.messageAction())
            assertEquals("admin@example.com", request.userAttributes().single().value())
            AdminCreateUserResponse.builder().user { it.attributes({ a -> a.name("sub").value("subject") }) }.build()
        }
        assertEquals("subject", service.invite("admin@example.com"))
        `when`(client.initiateAuth(any<Consumer<InitiateAuthRequest.Builder>>())).thenReturn(
            InitiateAuthResponse
                .builder()
                .challengeName("NEW_PASSWORD_REQUIRED")
                .session("session")
                .build(),
            InitiateAuthResponse
                .builder()
                .challengeName("NEW_PASSWORD_REQUIRED")
                .session("")
                .build(),
        )
        assertEquals(
            mapOf("challenge" to "NEW_PASSWORD_REQUIRED", "session" to "session"),
            service.signin("admin@example.com", "temporary"),
        )
        assertThrows(ResponseStatusException::class.java) { service.signin("admin@example.com", "temporary") }
        `when`(client.respondToAuthChallenge(any<Consumer<RespondToAuthChallengeRequest.Builder>>())).thenAnswer { invocation ->
            val builder = RespondToAuthChallengeRequest.builder()
            invocation.getArgument<Consumer<RespondToAuthChallengeRequest.Builder>>(0).accept(builder)
            val request = builder.build()
            assertEquals("client", request.clientId())
            assertEquals("session", request.session())
            assertEquals("NEW_PASSWORD_REQUIRED", request.challengeNameAsString())
            assertEquals(mapOf("USERNAME" to "admin@example.com", "NEW_PASSWORD" to "Replacement123!"), request.challengeResponses())
            RespondToAuthChallengeResponse
                .builder()
                .authenticationResult {
                    it
                        .accessToken("access")
                        .idToken("id")
                        .refreshToken("refresh")
                        .expiresIn(3600)
                        .tokenType("Bearer")
                }.build()
        }
        assertEquals("access", service.completePassword("admin@example.com", "session", "Replacement123!")["accessToken"])
        doReturn(RespondToAuthChallengeResponse.builder().build())
            .`when`(client)
            .respondToAuthChallenge(any<Consumer<RespondToAuthChallengeRequest.Builder>>())
        assertThrows(ResponseStatusException::class.java) { service.completePassword("admin@example.com", "session", "Replacement123!") }
    }
}
