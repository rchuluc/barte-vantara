package com.barte.vantara.users

import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import software.amazon.awssdk.core.exception.SdkException
import software.amazon.awssdk.services.cognitoidentityprovider.model.CognitoIdentityProviderException
import java.sql.SQLException

@RestControllerAdvice(assignableTypes = [UserController::class])
class UserErrors {
    // Default binding-error logs include rejected field values, including passwords.
    @ExceptionHandler(MethodArgumentNotValidException::class, HttpMessageNotReadableException::class)
    fun invalidRequest(): ResponseEntity<Map<String, String>> = ResponseEntity.badRequest().body(mapOf("error" to "Invalid request"))

    private val cognitoStatuses =
        mapOf(
            "NotAuthorizedException" to HttpStatus.UNAUTHORIZED,
            "UserNotFoundException" to HttpStatus.UNAUTHORIZED,
            "UserNotConfirmedException" to HttpStatus.UNAUTHORIZED,
            "PasswordResetRequiredException" to HttpStatus.UNAUTHORIZED,
            "UsernameExistsException" to HttpStatus.CONFLICT,
            "AliasExistsException" to HttpStatus.CONFLICT,
            "InvalidPasswordException" to HttpStatus.BAD_REQUEST,
            "InvalidParameterException" to HttpStatus.BAD_REQUEST,
            "TooManyRequestsException" to HttpStatus.TOO_MANY_REQUESTS,
            "LimitExceededException" to HttpStatus.TOO_MANY_REQUESTS,
        )

    @ExceptionHandler(SdkException::class)
    fun cognito(error: SdkException): ResponseEntity<Map<String, String>> {
        val code = (error as? CognitoIdentityProviderException)?.awsErrorDetails()?.errorCode()
        val status = cognitoStatuses[code] ?: HttpStatus.BAD_GATEWAY
        return ResponseEntity.status(status).body(mapOf("error" to status.reasonPhrase))
    }

    @ExceptionHandler(DataAccessException::class)
    fun database(error: DataAccessException): ResponseEntity<Map<String, String>> {
        val state = (error.mostSpecificCause as? SQLException)?.sqlState
        val status =
            when (state) {
                "42501" -> HttpStatus.FORBIDDEN
                "23503", "23505" -> HttpStatus.CONFLICT
                "23514" -> HttpStatus.BAD_REQUEST
                else -> HttpStatus.SERVICE_UNAVAILABLE
            }
        return ResponseEntity.status(status).body(mapOf("error" to status.reasonPhrase))
    }
}
