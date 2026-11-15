package com.barte.vantara.finance

import java.time.LocalDate
import java.util.UUID

/** Construct only after token verification; the database independently checks membership. */
data class VerifiedFinanceContext(
    val issuer: String,
    val subject: String,
    val tenantId: UUID,
    val actorKind: String,
)

/** Version 1 envelope for every input format; rawText is a faithful source slice. */
data class IngestionRecord(
    val unitId: UUID,
    val sourceSystem: String,
    val artifactRef: String,
    val artifactVersion: String,
    val contractVersion: Int,
    val datasetKind: String,
    val category: String,
    val locator: String,
    val rawText: String,
    val accountId: UUID? = null,
)

data class TitlePosition(
    val id: UUID,
    val unitId: UUID,
    val direction: String,
    val partyName: String?,
    val dueOn: LocalDate?,
    val currency: String,
    val originalMinor: Long,
    val currentMinor: Long,
    val outstandingMinor: Long,
)

interface FinanceRepository {
    fun ingest(record: IngestionRecord): UUID

    fun positions(): List<TitlePosition>
}

interface FinanceStore {
    /** Repository lifetime is one transaction. Throwing rolls back all writes. */
    fun <T> transaction(
        context: VerifiedFinanceContext,
        work: (FinanceRepository) -> T,
    ): T
}

class FinanceAccessDenied : RuntimeException("No active membership for the selected identity and tenant")

class SourceConflict : RuntimeException("Source key already exists with different evidence or classification")

class FinanceStorageFailure(
    cause: Throwable,
) : RuntimeException("Financial persistence operation failed", cause)
