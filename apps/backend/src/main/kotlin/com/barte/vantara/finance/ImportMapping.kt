package com.barte.vantara.finance

import tools.jackson.databind.JsonNode
import java.math.BigDecimal
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.UUID

data class ImportMapping(
    val columns: Map<String, String> = emptyMap(),
    val unitId: UUID? = null,
    val units: Map<String, UUID> = emptyMap(),
    val accountId: UUID? = null,
    val dateFormat: String? = null,
    val decimal: String? = null,
    val currency: String = "BRL",
)

internal object ImportNormalization {
    private val titleStatuses =
        mapOf(
            "n" to "open",
            "aberto" to "open",
            "open" to "open",
            "disputed" to "disputed",
            "cancelled" to "cancelled",
            "cancelado" to "cancelled",
        )
    private val paidFlags = setOf("y", "s", "pago", "paid")
    val fields =
        setOf(
            "party_name",
            "party_tax_id",
            "document_ref",
            "external_id",
            "issued_on",
            "due_on",
            "amount",
            "status",
            "unit",
            "booking_date",
            "description",
            "direction",
        )
    val profiles =
        mapOf(
            "omie" to
                mapOf(
                    "party_name" to "customer_name",
                    "party_tax_id" to "tax_id",
                    "document_ref" to "invoice_ref",
                    "due_on" to "due_date",
                    "amount" to "amount",
                    "status" to "paid_flag",
                ),
            "protheus" to
                mapOf(
                    "party_name" to "cliente",
                    "party_tax_id" to "cnpj",
                    "document_ref" to "documento",
                    "external_id" to "nosso_numero",
                    "issued_on" to "emissao",
                    "due_on" to "vencimento",
                    "amount" to "valor",
                    "status" to "status",
                    "unit" to "unidade",
                ),
            "itau" to
                mapOf(
                    "booking_date" to "data",
                    "description" to "historico",
                    "external_id" to "documento",
                    "amount" to "valor",
                    "direction" to "tipo",
                ),
        )

    fun normalize(
        cells: JsonNode,
        headers: List<String>,
        mapping: JsonNode,
        kind: String,
    ): Map<String, Any?> {
        require(cells.size() == headers.size) { "Row column count differs from header" }

        fun value(field: String): String? {
            val column = mapping["columns"][field]?.asText() ?: return null
            return cells[headers.indexOf(column)].asText().trim().ifEmpty { null }
        }

        fun required(field: String): String = value(field) ?: throw IllegalArgumentException("Missing $field")

        fun date(
            field: String,
            required: Boolean,
        ): LocalDate? {
            val text = if (required) required(field) else value(field) ?: return null
            return try {
                LocalDate.parse(text, DateTimeFormatter.ofPattern(mapping["dateFormat"].asText()).withResolverStyle(ResolverStyle.STRICT))
            } catch (_: java.time.DateTimeException) {
                throw IllegalArgumentException("Invalid $field date")
            }
        }
        val rawAmount = required("amount")
        val comma = mapping["decimal"].asText() == ","
        val pattern = if (comma) Regex("(?:[0-9]+|[0-9]{1,3}(?:\\.[0-9]{3})+)(?:,[0-9]{1,2})?") else Regex("[0-9]+(?:\\.[0-9]{1,2})?")
        require(pattern.matches(rawAmount)) { "Invalid amount format or precision" }
        val amount =
            try {
                BigDecimal(if (comma) rawAmount.replace(".", "").replace(',', '.') else rawAmount).movePointRight(2).longValueExact()
            } catch (_: ArithmeticException) {
                throw IllegalArgumentException("Amount exceeds supported range")
            }
        require(amount > 0) { "Amount must be positive" }
        val unit = if (mapping["columns"].has("unit")) mapping["units"][required("unit")]?.asText() else mapping["unitId"]?.asText()
        require(!unit.isNullOrBlank()) { "Business unit mapping required" }
        val common =
            mapOf(
                "unit_id" to UUID.fromString(unit),
                "amount" to amount,
                "currency" to mapping["currency"].asText(),
                "external_id" to value("external_id"),
            )
        if (kind == "bank") {
            val direction =
                when (required("direction").lowercase()) {
                    "c", "credit" -> "credit"
                    "d", "debit" -> "debit"
                    else -> throw IllegalArgumentException("Invalid bank direction")
                }
            return common +
                mapOf("booking_date" to date("booking_date", true), "description" to required("description"), "direction" to direction)
        }
        val sourceStatus = value("status")?.lowercase() ?: "open"
        require(sourceStatus !in paidFlags) { "Paid flags require settlement evidence; no settlement inferred" }
        val status = titleStatuses[sourceStatus] ?: throw IllegalArgumentException("Unsupported title status")
        val tax = value("party_tax_id")?.replace(Regex("[./\\- ]"), "")
        require(tax == null || tax.matches(Regex("[0-9]{11}|[0-9]{14}"))) { "Invalid tax identifier" }
        return common +
            mapOf(
                "party_name" to required("party_name"),
                "party_tax_id" to tax,
                "document_ref" to value("document_ref"),
                "issued_on" to date("issued_on", false),
                "due_on" to date("due_on", true),
                "status" to status,
            )
    }
}
