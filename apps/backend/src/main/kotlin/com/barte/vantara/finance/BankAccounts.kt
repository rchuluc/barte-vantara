package com.barte.vantara.finance

import com.barte.vantara.users.UserAccess
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import org.springframework.context.annotation.Profile
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

data class RegisterAccountRequest(
    @field:Size(min = 1, max = 100) val unitIds: Set<UUID>,
    @field:NotBlank @field:Size(max = 50) val bankCode: String,
    @field:NotBlank @field:Size(max = 200) val accountRef: String,
    @field:Pattern(regexp = "BRL|USD|EUR") val currency: String,
)

data class UpdateAccountRequest(
    @field:Size(min = 1, max = 100) val unitIds: Set<UUID>? = null,
    @field:NotBlank @field:Size(max = 50) val bankCode: String,
    @field:NotBlank @field:Size(max = 200) val accountRef: String,
    val active: Boolean,
)

@RestController
@RequestMapping("/api/bank-accounts")
@Profile("!migrate & !seed")
class BankAccounts(
    private val access: UserAccess,
    private val jdbc: JdbcTemplate,
) {
    @GetMapping
    fun list(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
    ): List<Map<String, Any?>> =
        access.transaction(jwt, tenant) { _, _ ->
            jdbc.queryForList("SELECT id FROM finance.bank_account ORDER BY bank_code, account_ref", UUID::class.java).map { account(it!!) }
        }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun register(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @Valid @RequestBody request: RegisterAccountRequest,
    ): Map<String, Any?> =
        access.transaction(jwt, tenant, true) { context, _ ->
            val id =
                jdbc.queryForObject(
                    "SELECT finance.register_account(?, ?, ?, ?, ?)",
                    UUID::class.java,
                    context.tenantId,
                    request.unitIds.first(),
                    request.bankCode,
                    request.accountRef,
                    request.currency,
                )!!
            setUnits(context.tenantId, id, request.unitIds)
            account(id)
        }

    @PatchMapping("/{id}")
    fun update(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
        @Valid @RequestBody request: UpdateAccountRequest,
    ): Map<String, Any?> =
        access.transaction(jwt, tenant, true) { context, _ ->
            val count =
                jdbc.update(
                    "UPDATE finance.bank_account SET bank_code=?, account_ref=?, active=? WHERE id=?",
                    request.bankCode.trim(),
                    request.accountRef.trim(),
                    request.active,
                    id,
                )
            if (count != 1) throw ResponseStatusException(HttpStatus.NOT_FOUND, "Bank account not found or not editable")
            request.unitIds?.let { setUnits(context.tenantId, id, it) }
            account(id)
        }

    private fun setUnits(
        tenant: UUID,
        id: UUID,
        units: Set<UUID>,
    ) {
        jdbc.queryForObject(
            "SELECT finance.set_account_units(?, ?, ?::uuid[])",
            String::class.java,
            tenant,
            id,
            units.joinToString(",", "{", "}"),
        )
    }

    private fun account(id: UUID): Map<String, Any?> =
        jdbc.queryForMap(
            "SELECT id, bank_code, account_ref, currency, active, finance.account_configurable(tenant_id, id) AS configurable FROM finance.bank_account WHERE id=?",
            id,
        ) +
            mapOf(
                "unit_ids" to
                    jdbc.queryForList(
                        "SELECT unit_id FROM finance.bank_account_unit WHERE account_id=? AND active ORDER BY unit_id",
                        UUID::class.java,
                        id,
                    ),
            )
}
