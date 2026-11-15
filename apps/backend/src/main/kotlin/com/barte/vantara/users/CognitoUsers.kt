package com.barte.vantara.users

import org.springframework.context.annotation.Profile
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.server.ResponseStatusException
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthFlowType
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthenticationResultType
import software.amazon.awssdk.services.cognitoidentityprovider.model.MessageActionType

@Component
@Profile("!migrate & !seed")
class CognitoUsers(
    private val client: CognitoIdentityProviderClient,
    private val properties: CognitoProperties,
) {
    fun signin(
        email: String,
        password: String,
    ): Map<String, Any> {
        val result =
            client.initiateAuth {
                it
                    .clientId(properties.clientId)
                    .authFlow(AuthFlowType.USER_PASSWORD_AUTH)
                    .authParameters(mapOf("USERNAME" to email, "PASSWORD" to password))
            }
        if (result.challengeNameAsString() == "NEW_PASSWORD_REQUIRED" && !result.session().isNullOrBlank()) {
            return mapOf("challenge" to "NEW_PASSWORD_REQUIRED", "session" to result.session())
        }
        return tokens(result.authenticationResult())
    }

    fun completePassword(
        email: String,
        session: String,
        password: String,
    ): Map<String, Any> {
        val result =
            client.respondToAuthChallenge {
                it
                    .clientId(properties.clientId)
                    .challengeName("NEW_PASSWORD_REQUIRED")
                    .session(session)
                    .challengeResponses(mapOf("USERNAME" to email, "NEW_PASSWORD" to password))
            }
        return tokens(result.authenticationResult())
    }

    private fun tokens(result: AuthenticationResultType?): Map<String, Any> {
        val tokens = result ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication challenge required")
        return mapOf(
            "accessToken" to tokens.accessToken(),
            "idToken" to tokens.idToken(),
            "refreshToken" to tokens.refreshToken(),
            "expiresIn" to tokens.expiresIn(),
            "tokenType" to tokens.tokenType(),
        )
    }

    fun invite(email: String): String {
        val user =
            client
                .adminCreateUser {
                    it
                        .userPoolId(properties.poolId)
                        .username(email)
                        .desiredDeliveryMediumsWithStrings("EMAIL")
                        .userAttributes({ attribute -> attribute.name("email").value(email) })
                }.user()
        return user.attributes().first { it.name() == "sub" }.value()
    }

    fun create(
        email: String,
        password: String,
    ): String {
        val user =
            client
                .adminCreateUser {
                    it
                        .userPoolId(properties.poolId)
                        .username(email)
                        .temporaryPassword(password)
                        .messageAction(MessageActionType.SUPPRESS)
                        .userAttributes({ a -> a.name("email").value(email) })
                }.user()
        try {
            client.adminSetUserPassword {
                it
                    .userPoolId(properties.poolId)
                    .username(user.username())
                    .password(password)
                    .permanent(true)
            }
        } catch (failure: Exception) {
            compensate(user.username(), failure)
            throw failure
        }
        return user.attributes().first { it.name() == "sub" }.value()
    }

    fun compensate(
        username: String,
        failure: Exception,
    ) {
        try {
            client.adminDeleteUser { it.userPoolId(properties.poolId).username(username) }
        } catch (cleanup: Exception) {
            failure.addSuppressed(cleanup)
        }
    }
}
