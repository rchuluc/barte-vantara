package com.barte.vantara

import com.barte.vantara.finance.MatchEvidence
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MatchEvidenceTests {
    @Test
    fun `suggestions distinguish references tax identifiers and truncated names from amount coincidence`() {
        val title = mapOf("party_name" to "Grão Nobre Comércio Ltda", "party_tax_id" to "55.666.777/0001-44", "document_ref" to "NF 123")
        assertTrue(MatchEvidence.identity(emptyMap(), emptyMap()).isEmpty())
        assertTrue(MatchEvidence.identity(mapOf("description" to "DEPOSITO NAO IDENTIFICADO", "amount_minor" to 3125000), title).isEmpty())
        assertEquals(listOf("Referência coincidente: NF 123"), MatchEvidence.identity(mapOf("external_ref" to "NF 123"), title))
        assertEquals(
            listOf("CNPJ identificado: 55.666.777/0001-44"),
            MatchEvidence.identity(mapOf("counterparty_tax_id" to "55666777000144"), title),
        )
        assertEquals(
            listOf("CNPJ identificado: 55.666.777/0001-44"),
            MatchEvidence.identity(mapOf("description" to "PIX 55666777000144"), title),
        )
        assertEquals(listOf("Nome no histórico: GRAO NOBRE"), MatchEvidence.identity(mapOf("description" to "TED GRAO NOBRE COM"), title))
        assertTrue(MatchEvidence.identity(mapOf("description" to "GRAO OUTRO"), title).isEmpty())
        assertTrue(
            MatchEvidence.identity(mapOf("description" to "GRAO"), mapOf("party_name" to "GRAO LTDA", "party_tax_id" to "123")).isEmpty(),
        )
    }
}
