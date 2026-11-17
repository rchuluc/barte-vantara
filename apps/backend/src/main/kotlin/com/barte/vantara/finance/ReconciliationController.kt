package com.barte.vantara.finance

import com.barte.vantara.users.UserAccess
import org.springframework.context.annotation.Profile
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.text.Normalizer
import java.time.LocalDate
import java.util.UUID

data class MatchAllocation(
    val titleId: UUID,
    val amountMinor: Long,
)

data class MatchInput(
    val id: UUID,
    val action: String,
    val allocations: List<MatchAllocation> = emptyList(),
    val rejectedTitleId: UUID? = null,
)

data class MatchReview(
    val decision: String,
)

/** Evidence is descriptive, never a confidence score. Amount alone is not identity. */
object MatchEvidence {
    private fun normalized(value: Any?): String =
        Normalizer
            .normalize(value?.toString().orEmpty(), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}"), "")
            .uppercase()
            .replace(Regex("[^A-Z0-9]+"), " ")
            .trim()

    fun identity(
        bank: Map<String, Any?>,
        title: Map<String, Any?>,
    ): List<String> {
        val evidence = mutableListOf<String>()
        val reference = bank["external_ref"]?.toString().orEmpty()
        if (reference.isNotBlank() && reference in listOf(title["external_id"], title["document_ref"])) {
            evidence.add("Referência coincidente: $reference")
        }
        val description = normalized(bank["description"])
        val taxId = title["party_tax_id"]?.toString().orEmpty().filter(Char::isDigit)
        if (taxId.length == 14 &&
            (description.filter(Char::isDigit).contains(taxId) || bank["counterparty_tax_id"]?.toString()?.filter(Char::isDigit) == taxId)
        ) {
            evidence.add("CNPJ identificado: ${title["party_tax_id"]}")
        }
        val words =
            normalized(title["party_name"]).split(" ").filter {
                it.length >= 3 &&
                    it !in setOf("LTDA", "COMERCIO", "ALIMENTOS", "FRANQUIAS")
            }
        if (words.size >= 2 && words.take(2).all { description.contains(it) }) {
            evidence.add("Nome no histórico: ${words.take(2).joinToString(" ")}")
        }
        return evidence
    }
}

@RestController
@RequestMapping("/api/reconciliation")
@Profile("!migrate & !seed")
class ReconciliationController(
    private val access: UserAccess,
    private val jdbc: JdbcTemplate,
) {
    @GetMapping("/search/{kind}")
    fun search(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable kind: String,
        @RequestParam(required = false) name: String?,
        @RequestParam(required = false) from: LocalDate?,
        @RequestParam(required = false) to: LocalDate?,
        @RequestParam(required = false) minAmountMinor: Long?,
        @RequestParam(required = false) maxAmountMinor: Long?,
        @RequestParam(required = false) unitId: UUID?,
        @RequestParam(required = false) direction: String?,
        @RequestParam(required = false) currency: String?,
        @RequestParam(required = false) bankId: UUID?,
        @RequestParam(required = false) state: String?,
        @RequestParam(defaultValue = "50") limit: Int,
        @RequestParam(defaultValue = "0") offset: Int,
    ): List<Map<String, Any?>> =
        access.transaction(jwt, tenant) { _, _ ->
            requireInput(kind in setOf("banks", "titles", "decisions"))
            requireInput(limit in 1..100 && offset >= 0 && (name == null || name.length <= 200))
            requireInput(from == null || to == null || from <= to)
            requireInput(listOfNotNull(minAmountMinor, maxAmountMinor).all { it in 0..9007199254740991L })
            requireInput(minAmountMinor == null || maxAmountMinor == null || minAmountMinor <= maxAmountMinor)
            requireInput(currency == null || currency.matches(Regex("[A-Z]{3}")))
            requireInput(
                direction == null || direction in if (kind == "titles") setOf("payable", "receivable") else setOf("credit", "debit"),
            )
            requireInput(
                state == null || state in if (kind == "decisions") setOf("pending", "confirmed", "rejected") else setOf("open", "settled"),
            )
            requireInput(bankId == null || kind in setOf("titles", "decisions"))
            val candidateBank = if (bankId != null && kind == "titles") bank(bankId) else null
            val table =
                when (kind) {
                    "banks" -> "finance.bank_position p"
                    "titles" ->
                        """finance.title_position p
                        JOIN finance.source_record s ON (s.tenant_id,s.id)=(p.tenant_id,p.source_id)
                        JOIN finance.import_batch batch ON (batch.tenant_id,batch.id)=(s.tenant_id,s.batch_id)"""
                    else ->
                        """finance.reconciliation_decision d
                        JOIN finance.bank_position p ON (p.tenant_id,p.id)=(d.tenant_id,d.bank_entry_id)
                        LEFT JOIN finance.reconciliation_review r ON (r.tenant_id,r.decision_id)=(d.tenant_id,d.id)"""
                }
            val date =
                when (kind) {
                    "titles" -> "p.due_on"
                    "decisions" -> "d.created_at"
                    else -> "p.booking_date"
                }
            val amount = if (kind == "titles") "p.current_amount_minor" else "p.amount_minor"
            val text =
                if (kind ==
                    "titles"
                ) {
                    "concat_ws(' ',p.party_name,p.document_ref,p.external_id)"
                } else {
                    "concat_ws(' ',p.description,p.external_ref)"
                }
            val status =
                when (kind) {
                    "decisions" -> "coalesce(r.decision,'pending')"
                    "titles" -> "CASE WHEN p.outstanding_minor>0 THEN 'open' ELSE 'settled' END"
                    else -> "CASE WHEN p.unallocated_minor>0 THEN 'open' ELSE 'settled' END"
                }
            val select =
                when (kind) {
                    "titles" -> "p.*,batch.source_system"
                    "decisions" ->
                        """d.*,r.decision AS review,r.actor_id AS reviewer_id,
                        r.created_at AS reviewed_at,$status AS approval_status"""
                    else ->
                        """p.*,finance.allowed(p.tenant_id,p.unit_id,'propose_match') AS can_propose,
                        finance.can_approve(p.tenant_id,p.unit_id,'review_reconciliation') AS can_review"""
                }
            val filters = mutableListOf<String>()
            val args = mutableListOf<Any>()

            fun filter(
                sql: String,
                value: Any?,
            ) {
                if (value != null) {
                    filters.add(sql)
                    args.add(value)
                }
            }
            filter("strpos(lower($text),lower(?))>0", name)
            filter("$date>=?::date", from)
            filter("$date<(?::date + interval '1 day')", to)
            filter("$amount>=?", minAmountMinor)
            filter("$amount<=?", maxAmountMinor)
            filter("p.unit_id=?", unitId)
            filter("p.direction=?", direction)
            filter("p.currency=?", currency)
            if (candidateBank != null) {
                filter("p.currency=?", candidateBank["currency"])
                filter("p.direction=?", if (candidateBank["direction"] == "credit") "receivable" else "payable")
                filters.add("p.status='open' AND p.observation_state='expected' AND p.outstanding_minor>0")
            } else {
                filter("p.id=?", bankId)
            }
            filter("($status)=?", state)
            args.add(limit)
            args.add(offset)
            val id = if (kind == "decisions") "d.id" else "p.id"
            rows(
                "SELECT $select FROM $table WHERE ${filters.joinToString(
                    " AND ",
                ).ifEmpty { "true" }} ORDER BY $date DESC NULLS LAST,$id LIMIT ? OFFSET ?",
                *args.toTypedArray(),
            ).map { row ->
                when {
                    kind == "decisions" ->
                        row +
                            (
                                "allocations" to
                                    rows(
                                        "SELECT title_id,amount_minor FROM finance.allocation WHERE decision_id=? ORDER BY title_id",
                                        row["id"]!!,
                                    )
                            )
                    candidateBank != null ->
                        row +
                            mapOf(
                                "identityEvidence" to MatchEvidence.identity(candidateBank, row),
                                "amountMatches" to (row["outstanding_minor"] == candidateBank["unallocated_minor"]),
                                "dateDifferenceDays" to
                                    row["due_on"]?.let {
                                        java.time.temporal.ChronoUnit.DAYS.between(
                                            LocalDate.parse(it.toString()),
                                            LocalDate.parse(candidateBank["booking_date"].toString()),
                                        )
                                    },
                            )
                    else -> row
                }
            }
        }

    @GetMapping
    fun workspace(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
    ): Map<String, Any?> =
        access.transaction(jwt, tenant) { _, actor ->
            val banks =
                rows(
                    """SELECT b.*, finance.allowed(b.tenant_id,b.unit_id,'propose_match') AS can_propose,
            finance.can_approve(b.tenant_id,b.unit_id,'review_reconciliation') AND finance.human_actor(b.tenant_id) AS can_review
            FROM finance.bank_position b JOIN finance.bank_account account ON (account.tenant_id,account.id)=(b.tenant_id,b.account_id)
            ORDER BY b.booking_date,b.id""",
                )
            val titles =
                rows(
                    """SELECT t.*, batch.source_system FROM finance.title_position t
            JOIN finance.source_record s ON (s.tenant_id,s.id)=(t.tenant_id,t.source_id)
            JOIN finance.import_batch batch ON (batch.tenant_id,batch.id)=(s.tenant_id,s.batch_id)
            ORDER BY t.due_on,t.id""",
                )
            val decisions =
                rows(
                    """SELECT d.*, r.decision AS review, r.actor_id AS reviewer_id, r.created_at AS reviewed_at
            FROM finance.reconciliation_decision d LEFT JOIN finance.reconciliation_review r
            ON (r.tenant_id,r.decision_id)=(d.tenant_id,d.id)
            WHERE d.bank_entry_id IS NOT NULL ORDER BY d.created_at DESC,d.id""",
                )
            val allocations =
                rows(
                    """SELECT a.decision_id,a.title_id,a.amount_minor FROM finance.allocation a
            JOIN finance.reconciliation_decision d ON (d.tenant_id,d.id)=(a.tenant_id,a.decision_id) WHERE d.bank_entry_id IS NOT NULL""",
                )
            mapOf(
                "banks" to banks,
                "titles" to titles,
                "decisions" to decisions,
                "allocations" to allocations,
                "actorId" to actor,
                "candidates" to
                    banks.filter { (it["unallocated_minor"] as Number).toLong() > 0 }.flatMap { bank ->
                        titles
                            .filter {
                                (it["direction"] == "receivable") == (bank["direction"] == "credit") &&
                                    it["currency"] == bank["currency"] &&
                                    it["status"] == "open" &&
                                    it["observation_state"] == "expected" &&
                                    (it["outstanding_minor"] as Number).toLong() > 0
                            }.mapNotNull { title ->
                                val identity = MatchEvidence.identity(bank, title)
                                if (identity.isEmpty()) {
                                    null
                                } else {
                                    mapOf(
                                        "bankId" to bank["id"],
                                        "titleId" to title["id"],
                                        "evidence" to (
                                            identity +
                                                listOfNotNull(
                                                    if (bank["amount_minor"] ==
                                                        title["current_amount_minor"]
                                                    ) {
                                                        "Valor coincidente"
                                                    } else {
                                                        null
                                                    },
                                                    if (bank["booking_date"] == title["due_on"]) "Crédito na data de vencimento" else null,
                                                )
                                        ),
                                    )
                                }
                            }
                    },
            )
        }

    @PostMapping("/{bankId}")
    fun save(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable bankId: UUID,
        @RequestBody input: MatchInput,
    ): Map<String, UUID> =
        access.transaction(jwt, tenant) { context, _ ->
            lock(context.tenantId)
            val bank = bank(bankId)
            requireInput(input.action in setOf("draft", "pending", "rejected_suggestion"))
            if (jdbc.queryForObject(
                    "SELECT finance.allowed(?,?,'propose_match')",
                    Boolean::class.java,
                    context.tenantId,
                    bank["unit_id"],
                ) !=
                true
            ) {
                forbidden()
            }
            val existing = jdbc.queryForList("SELECT id FROM finance.reconciliation_decision WHERE id=?", input.id)
            if (existing.isNotEmpty()) throw ResponseStatusException(HttpStatus.CONFLICT, "Decision already saved; refresh")
            requireInput(
                input.allocations.size <= 100 &&
                    input.allocations
                        .map { it.titleId }
                        .distinct()
                        .size == input.allocations.size,
            )
            requireInput((input.action == "draft") == input.allocations.isNotEmpty())
            requireInput((input.action == "rejected_suggestion") == (input.rejectedTitleId != null))
            validate(bank, input.allocations)
            if (input.rejectedTitleId != null) requireInput(MatchEvidence.identity(bank, title(input.rejectedTitleId)).isNotEmpty())
            jdbc.update(
                """INSERT INTO finance.reconciliation_decision
            (tenant_id,unit_id,id,origin,rationale,bank_entry_id,disposition,rejected_title_id)
            VALUES (?,?,?,?,?,?,?,?)""",
                context.tenantId,
                bank["unit_id"],
                input.id,
                context.actorKind,
                when (input.action) {
                    "draft" ->
                        if (context.actorKind ==
                            "ai"
                        ) {
                            "Proposta por agente; aguardando aprovação humana"
                        } else {
                            "Alocação proposta na bancada"
                        }
                    "pending" -> "Mantido pendente pelo operador"
                    else -> "Sugestão rejeitada pelo operador"
                },
                bankId,
                input.action,
                input.rejectedTitleId,
            )
            for (allocation in input.allocations) {
                jdbc.update(
                    """INSERT INTO finance.allocation
            (tenant_id,unit_id,decision_id,title_id,bank_entry_id,amount_minor,currency) VALUES (?,?,?,?,?,?,?)""",
                    context.tenantId,
                    bank["unit_id"],
                    input.id,
                    allocation.titleId,
                    bankId,
                    allocation.amountMinor,
                    bank["currency"],
                )
            }
            mapOf("id" to input.id)
        }

    @PostMapping("/decisions/{id}/review")
    fun review(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
        @RequestBody input: MatchReview,
    ): Map<String, UUID> =
        access.transaction(jwt, tenant) { context, actor ->
            lock(context.tenantId)
            requireInput(input.decision in setOf("confirmed", "rejected"))
            val decision =
                jdbc
                    .queryForList(
                        "SELECT * FROM finance.reconciliation_decision WHERE id=? AND bank_entry_id IS NOT NULL",
                        id,
                    ).singleOrNull()
                    ?: missing()
            if (decision["actor_id"] == actor) forbidden()
            if (jdbc.queryForObject("SELECT finance.decision_titles_reviewable(?,?)", Boolean::class.java, context.tenantId, id) !=
                true
            ) {
                forbidden()
            }
            val bank = bank(decision["bank_entry_id"] as UUID)
            val latest =
                jdbc
                    .queryForList(
                        """SELECT id FROM finance.reconciliation_decision WHERE bank_entry_id=? AND disposition<>'rejected_suggestion'
                        ORDER BY created_at DESC,id DESC LIMIT 1""",
                        bank["id"],
                    ).singleOrNull()
            if (latest?.get("id") != id) throw ResponseStatusException(HttpStatus.CONFLICT, "Proposal superseded")
            val allocations =
                jdbc.query(
                    "SELECT title_id,amount_minor FROM finance.allocation WHERE decision_id=?",
                    { rs, _ -> MatchAllocation(rs.getObject(1, UUID::class.java), rs.getLong(2)) },
                    id,
                )
            requireInput(allocations.isNotEmpty())
            if (input.decision == "confirmed") validate(bank, allocations, identityRequired = true)
            for (allocation in allocations) {
                val title = title(allocation.titleId)
                if (jdbc.queryForObject(
                        "SELECT finance.can_approve(?,?,'review_reconciliation')",
                        Boolean::class.java,
                        context.tenantId,
                        title["unit_id"],
                    ) !=
                    true
                ) {
                    forbidden()
                }
            }
            jdbc.update(
                """INSERT INTO finance.reconciliation_review (tenant_id,unit_id,decision_id,decision,reason)
            VALUES (?,?,?,?,?)""",
                context.tenantId,
                bank["unit_id"],
                id,
                input.decision,
                if (input.decision ==
                    "confirmed"
                ) {
                    "Alocações verificadas; registro somente nesta aplicação"
                } else {
                    "Proposta rejeitada pelo revisor"
                },
            )
            mapOf("id" to id)
        }

    @GetMapping("/{kind}/{id}/details")
    fun details(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable kind: String,
        @PathVariable id: UUID,
    ): Map<String, Any?> =
        access.transaction(jwt, tenant) { _, _ ->
            requireInput(kind in setOf("banks", "titles"))
            val record = if (kind == "banks") bank(id) else title(id)
            val source =
                jdbc
                    .queryForList(
                        """SELECT s.locator,s.raw_text,b.object_ref,b.source_version,i.id AS ingestion_id,i.filename
            FROM finance.source_record s JOIN finance.import_batch b ON (b.tenant_id,b.id)=(s.tenant_id,s.batch_id)
            LEFT JOIN finance.ingestion i ON i.tenant_id=b.tenant_id AND i.object_key=b.object_ref AND i.object_version=b.source_version
            WHERE s.id=?""",
                        record["source_id"],
                    ).singleOrNull() ?: missing()
            val history =
                rows(
                    """SELECT DISTINCT d.id,d.rationale,d.actor_id,d.created_at,d.disposition,
            r.decision AS review,r.actor_id AS reviewer_id,r.created_at AS reviewed_at
            FROM finance.reconciliation_decision d LEFT JOIN finance.reconciliation_review r
            ON (r.tenant_id,r.decision_id)=(d.tenant_id,d.id)
            LEFT JOIN finance.allocation a ON (a.tenant_id,a.decision_id)=(d.tenant_id,d.id)
            WHERE ${if (kind == "banks") "d.bank_entry_id" else "a.title_id"}=? ORDER BY d.created_at DESC""",
                    id,
                )
            mapOf("normalized" to clean(record), "source" to source, "history" to history)
        }

    private fun validate(
        bank: Map<String, Any?>,
        allocations: List<MatchAllocation>,
        identityRequired: Boolean = false,
    ) {
        var total = 0L
        for (allocation in allocations) {
            val title = title(allocation.titleId)
            requireInput(allocation.amountMinor > 0 && allocation.amountMinor <= (title["outstanding_minor"] as Number).toLong())
            requireInput(
                (title["direction"] == "receivable") == (bank["direction"] == "credit") &&
                    title["currency"] == bank["currency"] &&
                    title["status"] == "open" &&
                    title["observation_state"] == "expected",
            )
            if (identityRequired) requireInput(MatchEvidence.identity(bank, title).isNotEmpty())
            val available = (bank["unallocated_minor"] as Number).toLong()
            requireInput(allocation.amountMinor <= available - total)
            total += allocation.amountMinor
        }
    }

    private fun lock(tenant: UUID) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?::text,0))", { _, _ -> true }, tenant.toString())
    }

    private fun bank(id: UUID): Map<String, Any?> =
        jdbc.queryForList("SELECT * FROM finance.bank_position WHERE id=?", id).singleOrNull() ?: missing()

    private fun title(id: UUID): Map<String, Any?> =
        jdbc.queryForList("SELECT * FROM finance.title_position WHERE id=?", id).singleOrNull() ?: missing()

    private fun clean(row: Map<String, Any?>): Map<String, Any?> =
        row.mapValues { (_, value) -> if (value is java.sql.Date) value.toLocalDate().toString() else value }

    private fun rows(
        sql: String,
        vararg args: Any,
    ): List<Map<String, Any?>> = jdbc.queryForList(sql, *args).map(::clean)

    private fun missing(): Nothing = throw ResponseStatusException(HttpStatus.NOT_FOUND, "Record not available")

    private fun forbidden(): Nothing =
        throw ResponseStatusException(HttpStatus.FORBIDDEN, "Independent authorized reviewer or operator required")

    private fun requireInput(valid: Boolean) {
        if (!valid) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid allocation or insufficient identity evidence")
    }
}
