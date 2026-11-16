package com.barte.vantara.finance

import com.barte.vantara.users.UserAccess
import jakarta.servlet.http.HttpServletRequest
import org.springframework.context.annotation.Profile
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.nio.file.Files
import java.time.Instant
import java.util.UUID

/** A bounded preview only: no ingestion rows, audit objects or S3 writes. */
@RestController
@Profile("!migrate & !seed")
class ImportPreview(
    private val access: UserAccess,
    private val jdbc: JdbcTemplate,
) {
    @PostMapping("/api/imports/preview")
    fun preview(
        @AuthenticationPrincipal jwt: Jwt,
        @RequestHeader("X-Tenant-Id", required = false) tenant: UUID?,
        @RequestHeader("Idempotency-Key") id: UUID,
        @RequestParam filename: String,
        @RequestParam kind: String,
        request: HttpServletRequest,
    ): Map<String, Any?> {
        if (kind !in setOf("receivable", "payable", "bank") ||
            filename.length !in 1..200 ||
            filename.substringAfterLast('.').lowercase() !in setOf("csv", "xlsx")
        ) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a CSV or XLSX file and a supported dataset")
        }
        access.transaction(jwt, tenant) { context, _ ->
            val permission = if (kind == "bank") "bank" else "draft_$kind"
            if (jdbc.queryForObject("SELECT finance.allowed(?,NULL,?)", Boolean::class.java, context.tenantId, permission) != true) {
                throw ResponseStatusException(HttpStatus.FORBIDDEN, "Import permission required")
            }
            true
        }
        val path = Files.createTempFile("import-preview-", ".data")
        try {
            Files.newOutputStream(path).use { output ->
                val buffer = ByteArray(65536)
                var size = 0L
                while (true) {
                    val count = request.inputStream.read(buffer)
                    if (count < 0) break
                    size += count
                    if (size > 100L * 1024 * 1024) throw ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Maximum upload is 100 MiB")
                    output.write(buffer, 0, count)
                }
            }
            var headers = emptyList<String>()
            var total = 0L
            val rows = mutableListOf<Map<String, Any?>>()
            StructuredFiles.read(path, filename.endsWith(".xlsx", true)) { number, cells ->
                if (number == 1L) {
                    headers = cells.map { it.trim() }
                    require(
                        headers.none { it.isBlank() } && headers.distinct().size == headers.size,
                    ) { "Headers must be unique and nonempty" }
                } else {
                    total++
                    if (rows.size <
                        20
                    ) {
                        rows.add(
                            mapOf(
                                "row_number" to number,
                                "cells" to cells,
                                "corrected_cells" to null,
                                "state" to "pending",
                                "error" to null,
                                "result_id" to null,
                            ),
                        )
                    }
                }
            }
            require(headers.isNotEmpty()) { "Empty file" }
            val platform =
                StructuredFiles.profiles.entries
                    .firstOrNull { it.value.toSet() == headers.toSet() }
                    ?.key ?: "custom"
            val detectedKind =
                when (platform) {
                    "itau" -> "bank"
                    "protheus", "omie" -> "receivable"
                    else -> kind
                }
            if (detectedKind != kind) {
                access.transaction(jwt, tenant) { context, _ ->
                    val permission = if (detectedKind == "bank") "bank" else "draft_$detectedKind"
                    if (jdbc.queryForObject("SELECT finance.allowed(?,NULL,?)", Boolean::class.java, context.tenantId, permission) !=
                        true
                    ) {
                        throw ResponseStatusException(HttpStatus.FORBIDDEN, "Import permission required for detected dataset")
                    }
                    true
                }
            }
            return mapOf(
                "id" to id,
                "filename" to filename,
                "dataset_kind" to detectedKind,
                "platform" to platform,
                "state" to "mapping",
                "total" to total,
                "processed" to 0,
                "rejected" to 0,
                "created_at" to Instant.now(),
                "headers" to headers,
                "suggestedColumns" to ImportNormalization.profiles[platform].orEmpty(),
                "targetFields" to ImportNormalization.fieldsFor(detectedKind),
                "rows" to rows,
            )
        } catch (invalid: Exception) {
            if (invalid is ResponseStatusException) throw invalid
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Unable to preview this file. Check its format and contents.", invalid)
        } finally {
            Files.deleteIfExists(path)
        }
    }
}
