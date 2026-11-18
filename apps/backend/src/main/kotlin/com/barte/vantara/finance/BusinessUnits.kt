package com.barte.vantara.finance

import com.barte.vantara.users.UserAccess
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.context.annotation.Profile
import org.springframework.dao.DuplicateKeyException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.util.UUID

data class RegisterUnitRequest(
    @field:NotBlank @field:Size(max = 200) val name: String,
)

data class UpdateUnitRequest(
    @field:NotBlank @field:Size(max = 200) val name: String,
    val active: Boolean,
)

@RestController
@RequestMapping("/api/business-units")
@Profile("!migrate & !seed")
class BusinessUnits(
    private val access: UserAccess,
    private val jdbc: JdbcTemplate,
) {
    @GetMapping
    fun list(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
    ): List<Map<String, Any?>> =
        access.transaction(jwt, tenant) { _, _ -> jdbc.queryForList("SELECT id, name, active FROM finance.business_unit ORDER BY name") }

    @PatchMapping("/{id}")
    fun update(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
        @Valid @RequestBody request: UpdateUnitRequest,
    ): Map<String, Any?> =
        access.transaction(jwt, tenant, true) { _, _ ->
            jdbc
                .queryForList(
                    "UPDATE finance.business_unit SET name=?, active=? WHERE id=? RETURNING id, name, active",
                    request.name.trim(),
                    request.active,
                    id,
                ).singleOrNull() ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Business unit not found")
        }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun register(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @Valid @RequestBody request: RegisterUnitRequest,
    ): Map<String, Any> =
        try {
            access.transaction(jwt, tenant, true) { context, _ ->
                val id = jdbc.queryForObject("SELECT finance.register_unit(?, ?)", UUID::class.java, context.tenantId, request.name)!!
                mapOf("id" to id, "name" to request.name.trim(), "active" to true)
            }
        } catch (_: DuplicateKeyException) {
            throw ResponseStatusException(HttpStatus.CONFLICT, "Unit name already registered")
        }
}
