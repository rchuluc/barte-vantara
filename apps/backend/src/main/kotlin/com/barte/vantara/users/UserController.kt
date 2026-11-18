package com.barte.vantara.users

import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.context.annotation.Profile
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.util.UUID

class SigninRequest(
    @field:Email @field:NotBlank val email: String,
    @field:NotBlank @field:Size(max = 256) val password: String,
)

class CompletePasswordRequest(
    @field:Email @field:NotBlank val email: String,
    @field:NotBlank @field:Size(max = 2048) val session: String,
    @field:Size(min = 8, max = 256) val newPassword: String,
)

class CreateUserRequest(
    @field:Email @field:NotBlank @field:Size(max = 254) val email: String,
    @field:Size(min = 8, max = 256) val password: String,
    @field:Size(max = 200) val displayName: String = "",
    @field:Size(min = 1, max = 6) val roles: Set<String>,
    @field:Size(max = 100) val unitIds: Set<UUID> = emptySet(),
    @field:Size(max = 100) val bankAccountIds: Set<UUID> = emptySet(),
)

class PatchUserRequest(
    @field:Size(max = 200) val displayName: String? = null,
    val active: Boolean? = null,
    @field:Size(min = 1, max = 6) val roles: Set<String>? = null,
    @field:Size(max = 100) val unitIds: Set<UUID>? = null,
    @field:Size(max = 100) val bankAccountIds: Set<UUID>? = null,
)

@RestController
@RequestMapping("/api")
@Profile("!migrate & !seed")
class UserController(
    private val access: UserAccess,
    private val cognito: CognitoUsers,
    private val jdbc: JdbcTemplate,
) {
    @PostMapping("/signin")
    fun signin(
        @Valid @RequestBody request: SigninRequest,
    ): ResponseEntity<Map<String, Any>> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(cognito.signin(request.email.lowercase(), request.password))

    @PostMapping("/signin/password")
    fun completePassword(
        @Valid @RequestBody request: CompletePasswordRequest,
    ): ResponseEntity<Map<String, Any>> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(
            cognito.completePassword(request.email.lowercase(), request.session, request.newPassword),
        )

    @GetMapping("/me")
    fun me(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
    ): Map<String, Any?> =
        access.transaction(jwt, tenant) { context, id ->
            user(id) +
                mapOf(
                    "actorKind" to context.actorKind,
                    "permissions" to
                        jdbc.queryForList(
                            "SELECT DISTINCT p.permission FROM finance.member_role r JOIN finance.role_permission p USING (role) WHERE r.member_id = ? ORDER BY p.permission",
                            String::class.java,
                            id,
                        ),
                    "approvalScopes" to
                        if (context.actorKind ==
                            "human"
                        ) {
                            jdbc.queryForList("SELECT unit_id, permission FROM finance.approval_scope WHERE member_id = ?", id)
                        } else {
                            emptyList<Map<String, Any>>()
                        },
                )
        }

    @GetMapping("/users/roles")
    fun roles(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
    ): List<Map<String, Any?>> =
        access.transaction(
            jwt,
            tenant,
            true,
        ) { _, _ ->
            jdbc
                .queryForList("SELECT role, permission FROM finance.role_permission ORDER BY role, permission")
                .groupBy { it["role"] }
                .map { (role, rows) -> mapOf("role" to role, "permissions" to rows.map { it["permission"] }) }
        }

    @GetMapping("/users")
    fun list(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @RequestParam(defaultValue = "0") offset: Int,
        @RequestParam(defaultValue = "50") limit: Int,
    ): List<Map<String, Any?>> =
        access.transaction(jwt, tenant, true) { _, _ ->
            if (offset < 0 || limit !in 1..100) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid pagination")
            jdbc
                .queryForList("SELECT id FROM finance.membership ORDER BY id LIMIT ? OFFSET ?", UUID::class.java, limit, offset)
                .map { user(it!!) }
        }

    @GetMapping("/users/{id}")
    fun get(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
    ): Map<String, Any?> = access.transaction(jwt, tenant, true) { _, _ -> user(id) }

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    fun create(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @Valid @RequestBody request: CreateUserRequest,
    ): Map<String, Any?> {
        var created: String? = null
        try {
            return access.transaction(jwt, tenant, true) { context, _ ->
                validateRoles(request.roles)
                val email = request.email.lowercase()
                val subject = cognito.create(email, request.password)
                created = email
                val id = UUID.randomUUID()
                jdbc.update(
                    "INSERT INTO finance.membership (tenant_id, id, issuer, subject, email, display_name) VALUES (?, ?, ?, ?, ?, ?)",
                    context.tenantId,
                    id,
                    context.issuer,
                    subject,
                    email,
                    request.displayName,
                )
                scopes(context.tenantId, id, request.roles, request.unitIds, request.bankAccountIds)
                user(id)
            }
        } catch (failure: Exception) {
            created?.let { cognito.compensate(it, failure) }
            throw failure
        }
    }

    @PatchMapping("/users/{id}")
    fun patch(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
        @Valid @RequestBody request: PatchUserRequest,
    ): Map<String, Any?> =
        access.transaction(jwt, tenant, true) { context, actor ->
            editable(id, actor)
            // Lock the membership to serialize concurrent scope replacements.
            jdbc.queryForList("SELECT id FROM finance.membership WHERE id = ? FOR UPDATE", id)
            request.displayName?.let { jdbc.update("UPDATE finance.membership SET display_name = ? WHERE id = ?", it, id) }
            request.active?.let { jdbc.update("UPDATE finance.membership SET active = ? WHERE id = ?", it, id) }
            scopes(context.tenantId, id, request.roles, request.unitIds, request.bankAccountIds)
            user(id)
        }

    @DeleteMapping("/users/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
    ) {
        access.transaction(jwt, tenant, true) { _, actor ->
            editable(id, actor)
            jdbc.update("UPDATE finance.membership SET active = false WHERE id = ?", id)
        }
    }

    private fun editable(
        id: UUID,
        actor: UUID,
    ) {
        user(id)
        if (id == actor) throw ResponseStatusException(HttpStatus.FORBIDDEN, "Self administration is not allowed")
    }

    private fun user(id: UUID): Map<String, Any?> {
        val member =
            jdbc
                .queryForList(
                    "SELECT id, tenant_id, email, display_name, active, principal_kind FROM finance.membership WHERE id = ?",
                    id,
                ).singleOrNull()
                ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "User not found")
        return member +
            mapOf(
                "roles" to
                    jdbc.queryForList("SELECT role FROM finance.member_role WHERE member_id = ? ORDER BY role", String::class.java, id),
                "unitIds" to
                    jdbc.queryForList("SELECT unit_id FROM finance.member_unit WHERE member_id = ? ORDER BY unit_id", UUID::class.java, id),
                "bankAccountIds" to
                    jdbc.queryForList(
                        "SELECT DISTINCT account_id FROM finance.member_bank_account WHERE member_id = ? ORDER BY account_id",
                        UUID::class.java,
                        id,
                    ),
            )
    }

    private fun validateRoles(roles: Set<String>) {
        val known = jdbc.queryForList("SELECT DISTINCT role FROM finance.role_permission", String::class.java)
        if (!known.containsAll(roles)) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown role")
    }

    private fun scopes(
        tenant: UUID,
        id: UUID,
        roles: Set<String>?,
        units: Set<UUID>?,
        accounts: Set<UUID>?,
    ) {
        roles?.let {
            validateRoles(it)
            jdbc.update("DELETE FROM finance.member_role WHERE member_id = ?", id)
            it.forEach { role -> jdbc.update("INSERT INTO finance.member_role VALUES (?, ?, ?)", tenant, id, role) }
        }
        if (accounts != null) jdbc.update("DELETE FROM finance.member_bank_account WHERE member_id = ?", id)
        if (units != null) {
            // Existing approval/account scopes must be removed explicitly before removing their unit.
            val existing = jdbc.queryForList("SELECT unit_id FROM finance.member_unit WHERE member_id = ?", UUID::class.java, id)
            (existing - units).forEach { jdbc.update("DELETE FROM finance.member_unit WHERE member_id = ? AND unit_id = ?", id, it) }
            (units - existing.toSet()).forEach { jdbc.update("INSERT INTO finance.member_unit VALUES (?, ?, ?)", tenant, id, it) }
        }
        accounts?.let {
            it.forEach { account ->
                val count =
                    jdbc.update(
                        "INSERT INTO finance.member_bank_account SELECT s.tenant_id, ?, s.unit_id, s.account_id FROM finance.member_bank_account s JOIN finance.member_unit u ON (u.tenant_id, u.unit_id, u.member_id)=(s.tenant_id, s.unit_id, ?) WHERE s.tenant_id = ? AND s.member_id = finance.actor(s.tenant_id) AND s.account_id = ?",
                        id,
                        id,
                        tenant,
                        account,
                    )
                if (count == 0) throw ResponseStatusException(HttpStatus.FORBIDDEN, "Bank account is outside your scope")
            }
        }
    }
}
