package com.barte.vantara.tenants

import com.barte.vantara.users.CognitoProperties
import com.barte.vantara.users.CognitoUsers
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import org.springframework.context.annotation.Profile
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

data class TenantRegistration(
    val id: UUID,
    @field:Pattern(regexp = "^[a-z][a-z0-9-]{0,62}$") val slug: String,
    @field:NotBlank @field:Size(max = 100) val name: String,
    @field:Pattern(regexp = "^#[0-9a-fA-F]{6}$") val primary: String,
    @field:Size(min = 1, max = 20) val domains: Set<String>,
)

data class ProvisionTenantRequest(
    @field:Valid val tenant: TenantRegistration,
    @field:NotBlank @field:Email @field:Size(max = 254) val firstUserEmail: String,
)

@RestController
@Profile("!migrate & !seed")
class TenantController(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
    private val cognito: CognitoUsers,
    private val properties: CognitoProperties,
) {
    private val json = JsonMapper.builder().build()

    // Public, non-sensitive branding is needed before a visitor can sign in.
    @GetMapping("/api/tenants", "/api/admin/tenants")
    fun list(): ResponseEntity<List<TenantRegistration>> {
        val domains = jdbc.queryForList("SELECT tenant_id, domain FROM platform.tenant_domain ORDER BY domain")
        val tenants =
            jdbc.query("SELECT id, slug, name, primary_color FROM platform.tenant_registration ORDER BY slug") { row, _ ->
                val id = row.getObject("id", UUID::class.java)
                TenantRegistration(
                    id,
                    row.getString("slug"),
                    row.getString("name"),
                    row.getString("primary_color"),
                    domains.filter { it["tenant_id"] == id }.map { it["domain"] as String }.toSet(),
                )
            }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(tenants)
    }

    @PostMapping("/api/admin/tenants")
    fun create(
        @AuthenticationPrincipal jwt: Jwt,
        @Valid @RequestBody request: ProvisionTenantRequest,
    ): ResponseEntity<TenantRegistration> {
        val tenant = request.tenant
        if (tenant.domains.any { it.length > 253 || !it.matches(Regex("^[a-z0-9]+([.-][a-z0-9]+)*$")) }) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid domain")
        }
        var created: String? = null
        try {
            transactions.execute {
                jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtext('platform.register_tenant'))", { _, _ -> true })
                val existing = list().body!!
                if (existing.any { it.id == tenant.id || it.slug == tenant.slug || it.domains.intersect(tenant.domains).isNotEmpty() }) {
                    throw ResponseStatusException(HttpStatus.CONFLICT, "Tenant or domain already registered")
                }
                // Only this endpoint's GitHub-only filter chain can supply jwt.
                jdbc.queryForObject("SELECT set_config('app.platform_provisioner', 'github', true)", String::class.java)
                val email = request.firstUserEmail.lowercase()
                val subject = cognito.invite(email)
                created = email
                jdbc.queryForObject(
                    "SELECT platform.register_tenant(?, ?, ?, ?, ?::jsonb, ?, ?, ?)",
                    { _, _ -> true },
                    tenant.id,
                    tenant.slug,
                    tenant.name,
                    tenant.primary,
                    json.writeValueAsString(tenant.domains),
                    properties.issuer,
                    subject,
                    email,
                )
            }
        } catch (failure: Exception) {
            created?.let { cognito.compensate(it, failure) }
            throw failure
        }
        org.slf4j.LoggerFactory
            .getLogger(javaClass)
            .info("Tenant {} provisioned by {}", tenant.id, jwt.subject)
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(tenant)
    }
}
