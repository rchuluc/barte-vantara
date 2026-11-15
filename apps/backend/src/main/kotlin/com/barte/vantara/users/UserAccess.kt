package com.barte.vantara.users

import com.barte.vantara.finance.VerifiedFinanceContext
import org.springframework.context.annotation.Profile
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.server.ResponseStatusException
import java.util.UUID

/** Shared entry point for HTTP and delegated OIDC callers; no scope comes from request claims. */
@Component
@Profile("!migrate & !seed")
class UserAccess(
    private val jdbc: JdbcTemplate,
    private val transactions: TransactionTemplate,
    private val properties: CognitoProperties,
) {
    fun <T : Any> transaction(
        jwt: Jwt,
        tenant: UUID?,
        admin: Boolean = false,
        work: (VerifiedFinanceContext, UUID) -> T,
    ): T =
        transactions.execute {
            jdbc.queryForObject(
                "SELECT set_config('app.issuer', ?, true), set_config('app.subject', ?, true)",
                { _, _ -> true },
                jwt.issuer.toString(),
                jwt.subject,
            )
            val memberships = jdbc.queryForList("SELECT * FROM finance.identity_memberships()")
            val candidates = memberships.filter { tenant == null || it["tenant_id"] == tenant }
            if (candidates.size != 1) throw ResponseStatusException(HttpStatus.FORBIDDEN, "Select an active tenant membership")
            val member = candidates.single()
            val kind = if (jwt.getClaimAsString("client_id") == properties.mcpClientId) "ai" else member["principal_kind"] as String
            val context = VerifiedFinanceContext(jwt.issuer.toString(), jwt.subject!!, member["tenant_id"] as UUID, kind)
            jdbc.queryForObject(
                "SELECT set_config('app.tenant', ?, true), set_config('app.actor_kind', ?, true)",
                { _, _ -> true },
                context.tenantId.toString(),
                kind,
            )
            if (admin && !jdbc.queryForObject("SELECT finance.allowed(?, NULL, 'configure')", Boolean::class.java, context.tenantId)!!) {
                throw ResponseStatusException(HttpStatus.FORBIDDEN, "Technical Admin role required")
            }
            work(context, member["id"] as UUID)
        }!!
}
