package com.barte.vantara.finance

import com.barte.vantara.users.UserAccess
import jakarta.servlet.http.HttpServletRequest
import org.springframework.context.annotation.Profile
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
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
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody
import tools.jackson.databind.json.JsonMapper
import java.nio.file.Files
import java.security.MessageDigest
import java.time.LocalDate
import java.util.UUID

@RestController
@RequestMapping("/api/imports")
@Profile("!migrate & !seed")
class ImportController(
    private val access: UserAccess,
    private val jdbc: JdbcTemplate,
    private val files: ImportFiles,
) {
    private val json = JsonMapper.builder().build()

    @GetMapping
    fun list(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @RequestParam(defaultValue = "0") offset: Int,
        @RequestParam(defaultValue = "50") limit: Int,
        @RequestParam(required = false) name: String?,
        @RequestParam(required = false) state: String?,
        @RequestParam(required = false) kind: String?,
        @RequestParam(required = false) from: LocalDate?,
        @RequestParam(required = false) to: LocalDate?,
        @RequestParam(required = false) minAmountMinor: Long?,
        @RequestParam(required = false) maxAmountMinor: Long?,
    ): List<Map<String, Any?>> =
        access.transaction(jwt, tenant) { _, _ ->
            requireInput(offset >= 0 && limit in 1..100, "Invalid pagination")
            requireInput(name == null || name.length <= 200, "Invalid name")
            requireInput(state == null || state in setOf("uploading", "mapping", "processing", "completed", "failed"), "Invalid state")
            requireInput(kind == null || kind in setOf("bank", "payable", "receivable"), "Invalid kind")
            requireInput(from == null || to == null || from <= to, "Invalid date range")
            requireInput(listOfNotNull(minAmountMinor, maxAmountMinor).all { it in 0..9007199254740991L }, "Invalid amount")
            requireInput(minAmountMinor == null || maxAmountMinor == null || minAmountMinor <= maxAmountMinor, "Invalid amount range")
            jdbc.queryForList(
                """SELECT id,filename,dataset_kind,platform,state,total,processed,rejected,created_at FROM finance.ingestion
                WHERE (?::text IS NULL OR strpos(lower(filename),lower(?))>0)
                AND (?::text IS NULL OR state=?) AND (?::text IS NULL OR dataset_kind=?)
                AND (?::date IS NULL OR created_at>=?::date)
                AND (?::date IS NULL OR created_at<(?::date + interval '1 day'))
                AND ((?::bigint IS NULL AND ?::bigint IS NULL) OR EXISTS (
                    SELECT 1 FROM finance.ingestion_row row
                    LEFT JOIN finance.title_position t ON t.tenant_id=row.tenant_id AND t.id=row.result_id
                    LEFT JOIN finance.bank_position b ON b.tenant_id=row.tenant_id AND b.id=row.result_id
                    WHERE row.ingestion_id=ingestion.id AND row.tenant_id=ingestion.tenant_id
                    AND coalesce(t.current_amount_minor,b.amount_minor)>=coalesce(?::bigint,0)
                    AND coalesce(t.current_amount_minor,b.amount_minor)<=coalesce(?::bigint,9007199254740991)))
                ORDER BY created_at DESC,id LIMIT ? OFFSET ?""",
                name,
                name,
                state,
                state,
                kind,
                kind,
                from,
                from,
                to,
                to,
                minAmountMinor,
                maxAmountMinor,
                minAmountMinor,
                maxAmountMinor,
                limit,
                offset,
            )
        }

    @PostMapping("/{id}/prepare")
    fun prepare(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
    ): Map<String, Any?> {
        val job = access.transaction(jwt, tenant) { _, _ -> job(id) }
        if (job["state"] !in setOf("uploading", "failed")) return get(jwt, tenant, id)
        val version =
            job["object_version"] as String?
                ?: throw ResponseStatusException(HttpStatus.CONFLICT, "Original file is not persisted; upload again with a new key")
        val path = Files.createTempFile("ingestion-recovery-", ".data")
        try {
            files.open(job["object_key"] as String, version).use { input -> Files.newOutputStream(path).use { input.copyTo(it) } }
            stage(jwt, tenant, id, job["filename"] as String, path)
            return get(jwt, tenant, id)
        } finally {
            Files.deleteIfExists(path)
        }
    }

    @PatchMapping("/{id}/rows/{number}")
    fun correct(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
        @PathVariable number: Long,
        @RequestBody cells: List<String>,
    ): Map<String, Any?> {
        access.transaction(jwt, tenant) { _, _ ->
            val job = lockedJob(id)
            requireInput(
                cells.size == json.readTree(job["headers"].toString()).size() && cells.all { it.length <= 16384 },
                "Invalid correction shape",
            )
            if (job["state"] !in setOf("completed", "processing") ||
                jdbc.update(
                    "UPDATE finance.ingestion_row SET corrected_cells=?::jsonb,state='pending',error=NULL WHERE ingestion_id=? AND row_number=? AND state='rejected'",
                    json.writeValueAsString(cells),
                    id,
                    number,
                ) !=
                1
            ) {
                throw ResponseStatusException(HttpStatus.CONFLICT, "Only rejected rows may be corrected")
            }
            jdbc.update("UPDATE finance.ingestion SET state='processing',processed=processed-1,rejected=rejected-1 WHERE id=?", id)
        }
        return get(jwt, tenant, id)
    }

    @PostMapping("/{id}/confirm")
    fun confirm(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
        @RequestBody mapping: ImportMapping,
    ): Map<String, Any?> {
        access.transaction(jwt, tenant) { context, _ ->
            val job = lockedJob(id)
            val platform = job["platform"] as String
            val kind = job["dataset_kind"] as String
            requireInput(
                platform == "custom" || (platform == "itau") == (kind == "bank") && kind != "payable",
                "Detected format does not match dataset kind",
            )
            val columns = mapping.columns.ifEmpty { ImportNormalization.profiles[platform].orEmpty() }
            val headers = json.readTree(job["headers"].toString()).toList().map { it.asText() }
            val required =
                if (kind ==
                    "bank"
                ) {
                    setOf("amount", "booking_date", "description", "direction")
                } else {
                    setOf("amount", "party_name", "due_on")
                }
            requireInput(
                columns.keys.containsAll(required) &&
                    columns.keys.all { it in ImportNormalization.fields } &&
                    columns.values.all { it in headers },
                "Map required fields to existing columns",
            )
            val dateFormat = mapping.dateFormat ?: if (platform in setOf("protheus", "itau")) "dd/MM/uuuu" else "uuuu-MM-dd"
            val decimal = mapping.decimal ?: if (platform in setOf("protheus", "itau")) "," else "."
            requireInput(
                dateFormat in setOf("dd/MM/uuuu", "uuuu-MM-dd") &&
                    decimal in setOf(",", ".") &&
                    mapping.currency in setOf("BRL", "USD", "EUR"),
                "Unsupported locale or currency",
            )
            val effective =
                linkedMapOf<String, Any?>(
                    "columns" to columns,
                    "unitId" to mapping.unitId,
                    "units" to mapping.units,
                    "accountId" to mapping.accountId,
                    "dateFormat" to dateFormat,
                    "decimal" to decimal,
                    "currency" to mapping.currency,
                )
            val resolvedUnits = mapping.units.toMutableMap()
            if (platform == "protheus" && columns.containsKey("unit")) {
                if (job["state"] == "mapping") {
                    val names =
                        jdbc.queryForList(
                            "SELECT DISTINCT btrim(cells->>?) FROM finance.ingestion_row WHERE ingestion_id=? AND nullif(btrim(cells->>?), '') IS NOT NULL LIMIT 1001",
                            String::class.java,
                            headers.indexOf(columns["unit"]),
                            id,
                            headers.indexOf(columns["unit"]),
                        )
                    requireInput(names.size <= 1000, "Maximum 1000 business units per import")
                    for (name in names) {
                        if (!resolvedUnits.containsKey(name)) {
                            resolvedUnits[name!!] =
                                jdbc
                                    .queryForList(
                                        "SELECT id FROM finance.business_unit WHERE name=?",
                                        UUID::class.java,
                                        name,
                                    ).singleOrNull()
                                    ?: jdbc.queryForObject("SELECT finance.register_unit(?,?)", UUID::class.java, context.tenantId, name)!!
                        }
                    }
                } else {
                    json.readTree(job["mapping"].toString())["units"].properties().forEach { (name, unit) ->
                        resolvedUnits.putIfAbsent(name, UUID.fromString(unit.asText()))
                    }
                }
                effective["units"] = resolvedUnits
            }
            if (job["state"] != "mapping") {
                if (job["state"] in setOf("processing", "completed") &&
                    json.readTree(job["mapping"].toString()) == json.valueToTree<tools.jackson.databind.JsonNode>(effective)
                ) {
                    return@transaction true
                }
                throw ResponseStatusException(HttpStatus.CONFLICT, "Import mapping is already locked or unavailable")
            }
            val unitIds = if (columns.containsKey("unit")) resolvedUnits.values.toSet() else setOfNotNull(mapping.unitId)
            requireInput(unitIds.isNotEmpty(), "Select destination business units")
            for (unit in unitIds) {
                authorize(context.tenantId, unit, kind)
                if (kind == "bank") {
                    requireInput(mapping.accountId != null, "Select bank account")
                    if (jdbc.queryForObject(
                            "SELECT count(*) FROM finance.bank_account WHERE id=? AND unit_id=? AND currency=?",
                            Int::class.java,
                            mapping.accountId,
                            unit,
                            mapping.currency,
                        ) !=
                        1
                    ) {
                        throw ResponseStatusException(HttpStatus.FORBIDDEN, "Bank account is not available in this unit and currency")
                    }
                }
                jdbc.update("INSERT INTO finance.ingestion_scope VALUES (?,?,?,?)", context.tenantId, id, unit, mapping.accountId)
                jdbc.update(
                    "INSERT INTO finance.import_batch (tenant_id,unit_id,source_system,object_ref,source_version,dataset_kind) VALUES (?,?,?,?,?,?)",
                    context.tenantId,
                    unit,
                    platform,
                    job["object_key"],
                    job["object_version"],
                    kind,
                )
            }
            jdbc.update(
                "UPDATE finance.ingestion SET mapping=?::jsonb,state='processing' WHERE id=?",
                json.writeValueAsString(effective),
                id,
            )
        }
        return get(jwt, tenant, id)
    }

    @PostMapping("/{id}/process")
    fun process(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
    ): Map<String, Any?> {
        access.transaction(jwt, tenant) { context, _ ->
            val job = lockedJob(id)
            if (job["state"] == "completed") return@transaction true
            if (job["state"] != "processing") throw ResponseStatusException(HttpStatus.CONFLICT, "Confirm mapping first")
            val kind = job["dataset_kind"] as String
            val mapping = json.readTree(job["mapping"].toString())
            val headers = json.readTree(job["headers"].toString()).toList().map { it.asText() }
            val rows =
                jdbc.queryForList(
                    "SELECT row_number,cells,coalesce(corrected_cells,cells) AS effective_cells FROM finance.ingestion_row WHERE ingestion_id=? AND state='pending' ORDER BY row_number LIMIT 500",
                    id,
                )
            var rejected = 0
            for (row in rows) {
                val values =
                    try {
                        ImportNormalization.normalize(json.readTree(row["effective_cells"].toString()), headers, mapping, kind)
                    } catch (
                        invalid: IllegalArgumentException,
                    ) {
                        jdbc.update(
                            "UPDATE finance.ingestion_row SET state='rejected',error=? WHERE ingestion_id=? AND row_number=?",
                            invalid.message,
                            id,
                            row["row_number"],
                        )
                        rejected++
                        continue
                    }
                val source = UUID.randomUUID()
                val result = UUID.randomUUID()
                val category = if (kind == "bank" && values["direction"] == "credit") "incoming_bank" else kind
                val account = mapping["accountId"].takeUnless { it.isNull }?.asText()?.let(UUID::fromString)
                jdbc.update(
                    """INSERT INTO finance.source_record (tenant_id,unit_id,id,batch_id,dataset_kind,category,locator,raw_text,account_id)
                    SELECT ?,?,?,id,?,?,?,?,? FROM finance.import_batch WHERE tenant_id=? AND unit_id=? AND object_ref=? AND source_version=?""",
                    context.tenantId,
                    values["unit_id"],
                    source,
                    kind,
                    category,
                    "record:${row["row_number"]}",
                    row["cells"].toString(),
                    account,
                    context.tenantId,
                    values["unit_id"],
                    job["object_key"],
                    job["object_version"],
                )
                if (kind == "bank") {
                    jdbc.update(
                        """INSERT INTO finance.bank_entry (tenant_id,unit_id,id,account_id,direction,booking_date,amount_minor,currency,description,external_ref,source_id)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                        context.tenantId,
                        values["unit_id"],
                        result,
                        account,
                        values["direction"],
                        values["booking_date"],
                        values["amount"],
                        values["currency"],
                        values["description"],
                        values["external_id"],
                        source,
                    )
                } else {
                    jdbc.update(
                        """INSERT INTO finance.title (tenant_id,unit_id,id,direction,party_name,party_tax_id,external_id,document_ref,issued_on,due_on,currency,original_amount_minor,current_amount_minor,status,source_id,latest_source_id)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        context.tenantId,
                        values["unit_id"],
                        result,
                        kind,
                        values["party_name"],
                        values["party_tax_id"],
                        values["external_id"],
                        values["document_ref"],
                        values["issued_on"],
                        values["due_on"],
                        values["currency"],
                        values["amount"],
                        values["amount"],
                        values["status"],
                        source,
                        source,
                    )
                }
                jdbc.update(
                    "INSERT INTO finance.source_review (tenant_id,unit_id,source_id,state,interpretation,origin) VALUES (?,?,?,'parsed',?::jsonb,'rule')",
                    context.tenantId,
                    values["unit_id"],
                    source,
                    json.writeValueAsString(values),
                )
                jdbc.update(
                    "UPDATE finance.ingestion_row SET state='accepted',result_id=? WHERE ingestion_id=? AND row_number=?",
                    result,
                    id,
                    row["row_number"],
                )
            }
            jdbc.update(
                "UPDATE finance.ingestion SET processed=processed+?,rejected=rejected+?,state=CASE WHEN processed+?=total THEN 'completed' ELSE 'processing' END WHERE id=?",
                rows.size,
                rejected,
                rows.size,
                id,
            )
        }
        return get(jwt, tenant, id)
    }

    @GetMapping("/{id}/results")
    fun results(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
        @RequestParam(defaultValue = "0") after: Long,
        @RequestParam(defaultValue = "50") limit: Int,
    ): List<Map<String, Any?>> =
        access.transaction(jwt, tenant) { _, _ ->
            requireInput(after >= 0 && limit in 1..500, "Invalid pagination")
            val job = job(id)
            val table = if (job["dataset_kind"] == "bank") "bank_entry" else "title"
            jdbc
                .queryForList(
                    "SELECT r.row_number,t.* FROM finance.ingestion_row r JOIN finance.$table t ON t.tenant_id=r.tenant_id AND t.id=r.result_id WHERE r.ingestion_id=? AND r.row_number>? ORDER BY r.row_number LIMIT ?",
                    id,
                    after,
                    limit,
                ).map { row -> row.mapValues { (_, value) -> if (value is java.sql.Date) value.toLocalDate() else value } }
        }

    private fun lockedJob(id: UUID): Map<String, Any?> =
        jdbc.queryForList("SELECT * FROM finance.ingestion WHERE id=? FOR UPDATE", id).singleOrNull()
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Import not found")

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun upload(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @RequestParam filename: String,
        @RequestParam kind: String,
        @RequestHeader("Idempotency-Key", required = false) idempotencyKey: UUID?,
        request: HttpServletRequest,
    ): Map<String, Any?> {
        requireInput(kind in setOf("receivable", "payable", "bank"), "Invalid dataset kind")
        requireInput(
            filename.length in 1..200 && filename.substringAfterLast('.').lowercase() in setOf("csv", "xlsx"),
            "Expected CSV or XLSX file",
        )
        val id = idempotencyKey ?: UUID.randomUUID()
        val reservation =
            access.transaction(jwt, tenant) { context, _ ->
                authorize(context.tenantId, null, kind)
                val key = "${context.tenantId}/$id/original"
                val inserted =
                    jdbc.update(
                        "INSERT INTO finance.ingestion (tenant_id,id,filename,dataset_kind,object_key) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",
                        context.tenantId,
                        id,
                        filename,
                        kind,
                        key,
                    )
                if (inserted == 0) {
                    val existing = job(id)
                    if (existing["filename"] != filename ||
                        existing["dataset_kind"] != kind
                    ) {
                        throw ResponseStatusException(HttpStatus.CONFLICT, "Idempotency key already used")
                    }
                }
                key to inserted
            }
        if (reservation.second == 0) return get(jwt, tenant, id)
        val key = reservation.first
        val path = Files.createTempFile("ingestion-", ".csv")
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            Files.newOutputStream(path).use { out ->
                val buffer = ByteArray(65536)
                var size = 0L
                while (true) {
                    val count = request.inputStream.read(buffer)
                    if (count < 0) break
                    size += count
                    if (size > 100L * 1024 * 1024) throw ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Maximum upload is 100 MiB")
                    digest.update(buffer, 0, count)
                    out.write(buffer, 0, count)
                }
            }
            val hash = digest.digest().joinToString("") { "%02x".format(it) }
            val version = files.put(key, path, hash)
            access.transaction(jwt, tenant) { _, _ ->
                jdbc.update("UPDATE finance.ingestion SET object_version=?, sha256=? WHERE id=?", version, hash, id)
            }
            stage(jwt, tenant, id, filename, path)
            return get(jwt, tenant, id)
        } catch (failure: Exception) {
            access.transaction(
                jwt,
                tenant,
            ) { _, _ -> jdbc.update("UPDATE finance.ingestion SET state='failed' WHERE id=? AND state='uploading'", id) }
            throw failure
        } finally {
            Files.deleteIfExists(path)
        }
    }

    private fun stage(
        jwt: Jwt,
        tenant: UUID?,
        id: UUID,
        filename: String,
        path: java.nio.file.Path,
    ) {
        try {
            var headers = emptyList<String>()
            val pending = mutableListOf<Pair<Long, String>>()

            fun flush() {
                if (pending.isEmpty()) return
                access.transaction(jwt, tenant) { context, _ ->
                    val inserted =
                        jdbc
                            .batchUpdate(
                                "INSERT INTO finance.ingestion_row (tenant_id,ingestion_id,row_number,cells) VALUES (?,?,?,?::jsonb) ON CONFLICT DO NOTHING",
                                pending.map { arrayOf<Any>(context.tenantId, id, it.first, it.second) },
                            ).count { it != 0 }
                    jdbc.update("UPDATE finance.ingestion SET total=total+? WHERE id=? AND state IN ('uploading','failed')", inserted, id)
                }
                pending.clear()
            }
            StructuredFiles.read(path, filename.endsWith(".xlsx", true)) { number, cells ->
                if (number == 1L) {
                    headers = cells.map { it.trim() }
                    requireInput(
                        headers.none { it.isBlank() } && headers.distinct().size == headers.size,
                        "Headers must be unique and nonempty",
                    )
                } else {
                    pending.add(number to json.writeValueAsString(cells))
                    if (pending.size == 500) flush()
                }
            }
            requireInput(headers.isNotEmpty(), "Empty file")
            flush()
            val platform =
                StructuredFiles.profiles.entries
                    .firstOrNull { it.value.toSet() == headers.toSet() }
                    ?.key ?: "custom"
            access.transaction(jwt, tenant) { _, _ ->
                jdbc.update(
                    "UPDATE finance.ingestion SET headers=?::jsonb,platform=?,state='mapping' WHERE id=? AND state IN ('uploading','failed')",
                    json.writeValueAsString(headers),
                    platform,
                    id,
                )
            }
        } catch (failure: Exception) {
            access.transaction(
                jwt,
                tenant,
            ) { _, _ -> jdbc.update("UPDATE finance.ingestion SET state='failed' WHERE id=? AND state IN ('uploading','failed')", id) }
            if (failure is IllegalArgumentException ||
                failure is java.io.IOException ||
                failure is java.io.UncheckedIOException ||
                failure is org.xml.sax.SAXException ||
                failure is org.apache.poi.openxml4j.exceptions.OpenXML4JException
            ) {
                throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid structured file")
            }
            throw failure
        }
    }

    @GetMapping("/{id}")
    fun get(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
    ): Map<String, Any?> =
        access.transaction(jwt, tenant) { _, _ ->
            val job = job(id)
            job +
                mapOf(
                    "headers" to json.readTree(job["headers"].toString()),
                    "mapping" to json.readTree(job["mapping"].toString()),
                    "suggestedColumns" to ImportNormalization.profiles[job["platform"]].orEmpty(),
                    "targetFields" to ImportNormalization.fieldsFor(job["dataset_kind"] as String),
                )
        }

    @GetMapping("/{id}/rows")
    fun rows(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
        @RequestParam(defaultValue = "0") after: Long,
        @RequestParam(defaultValue = "20") limit: Int,
    ): List<Map<String, Any?>> =
        access.transaction(jwt, tenant) { _, _ ->
            requireInput(after >= 0 && limit in 1..500, "Invalid pagination")
            job(id)
            jdbc
                .queryForList(
                    "SELECT row_number,cells,corrected_cells,state,error,result_id FROM finance.ingestion_row WHERE ingestion_id=? AND row_number>? ORDER BY row_number LIMIT ?",
                    id,
                    after,
                    limit,
                ).map {
                    it +
                        mapOf(
                            "cells" to json.readTree(it["cells"].toString()),
                            "corrected_cells" to it["corrected_cells"]?.let { value -> json.readTree(value.toString()) },
                        )
                }
        }

    @GetMapping("/{id}/file")
    fun download(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @PathVariable id: UUID,
    ): ResponseEntity<StreamingResponseBody> {
        val job = access.transaction(jwt, tenant) { _, _ -> job(id) }
        val version = job["object_version"] as String? ?: throw ResponseStatusException(HttpStatus.CONFLICT, "File not yet persisted")
        return ResponseEntity
            .ok()
            .cacheControl(CacheControl.noStore())
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header("Content-Disposition", "attachment; filename=original")
            .body(StreamingResponseBody { output -> files.open(job["object_key"] as String, version).use { it.copyTo(output) } })
    }

    private fun job(id: UUID): Map<String, Any?> =
        jdbc.queryForList("SELECT * FROM finance.ingestion WHERE id=?", id).singleOrNull()
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Import not found")

    private fun authorize(
        tenant: UUID,
        unit: UUID?,
        kind: String,
    ) {
        val permission = if (kind == "bank") "bank" else "draft_$kind"
        if (jdbc.queryForObject("SELECT finance.allowed(?,?,?)", Boolean::class.java, tenant, unit, permission) != true) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "Import permission required")
        }
    }

    private fun requireInput(
        valid: Boolean,
        message: String,
    ) {
        if (!valid) throw ResponseStatusException(HttpStatus.BAD_REQUEST, message)
    }
}
