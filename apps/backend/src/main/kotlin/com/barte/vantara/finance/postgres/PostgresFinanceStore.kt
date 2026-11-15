package com.barte.vantara.finance.postgres

import com.barte.vantara.finance.FinanceAccessDenied
import com.barte.vantara.finance.FinanceRepository
import com.barte.vantara.finance.FinanceStorageFailure
import com.barte.vantara.finance.FinanceStore
import com.barte.vantara.finance.IngestionRecord
import com.barte.vantara.finance.SourceConflict
import com.barte.vantara.finance.TitlePosition
import com.barte.vantara.finance.VerifiedFinanceContext
import java.sql.Connection
import java.sql.SQLException
import java.time.LocalDate
import java.util.UUID
import javax.sql.DataSource

class PostgresFinanceStore(
    private val dataSource: DataSource,
) : FinanceStore {
    override fun <T> transaction(
        context: VerifiedFinanceContext,
        work: (FinanceRepository) -> T,
    ): T =
        translateFailure {
            dataSource.connection.use { connection ->
                connection.transactionIsolation = Connection.TRANSACTION_READ_COMMITTED
                connection.autoCommit = false
                try {
                    connection
                        .prepareStatement(
                            "SELECT set_config('app.issuer', ?, true), set_config('app.subject', ?, true), " +
                                "set_config('app.tenant', ?, true), set_config('app.actor_kind', ?, true)",
                        ).use {
                            it.setString(1, context.issuer)
                            it.setString(2, context.subject)
                            it.setString(3, context.tenantId.toString())
                            it.setString(4, context.actorKind)
                            it.execute()
                        }
                    connection.prepareStatement("SELECT finance.actor(?)").use {
                        it.setObject(1, context.tenantId)
                        it.executeQuery().use { result ->
                            result.next()
                            if (result.getObject(1) == null) throw FinanceAccessDenied()
                        }
                    }
                    val result = work(PostgresFinanceRepository(connection, context.tenantId))
                    connection.commit()
                    result
                } catch (error: Exception) {
                    connection.rollback()
                    throw error
                }
            }
        }
}

private class PostgresFinanceRepository(
    private val connection: Connection,
    private val tenantId: UUID,
) : FinanceRepository {
    override fun ingest(record: IngestionRecord): UUID =
        translateFailure {
            val batchId =
                connection
                    .prepareStatement(
                        """
                        INSERT INTO finance.import_batch
                            (tenant_id, unit_id, source_system, object_ref, source_version, contract_version, dataset_kind)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT (tenant_id, unit_id, source_system, object_ref, source_version) DO NOTHING
                        """.trimIndent(),
                    ).use {
                        it.setObject(1, tenantId)
                        it.setObject(2, record.unitId)
                        it.setString(3, record.sourceSystem)
                        it.setString(4, record.artifactRef)
                        it.setString(5, record.artifactVersion)
                        it.setInt(6, record.contractVersion)
                        it.setString(7, record.datasetKind)
                        it.executeUpdate()
                        connection
                            .prepareStatement(
                                """
                                SELECT id, dataset_kind, contract_version FROM finance.import_batch
                                WHERE tenant_id = ? AND unit_id = ? AND source_system = ? AND object_ref = ? AND source_version = ?
                                """.trimIndent(),
                            ).use { select ->
                                select.setObject(1, tenantId)
                                select.setObject(2, record.unitId)
                                select.setString(3, record.sourceSystem)
                                select.setString(4, record.artifactRef)
                                select.setString(5, record.artifactVersion)
                                select.executeQuery().use { result ->
                                    result.next()
                                    if (result.getString("dataset_kind") != record.datasetKind) {
                                        throw SourceConflict()
                                    }
                                    result.getObject("id", UUID::class.java)
                                }
                            }
                    }
            connection
                .prepareStatement(
                    """
                    INSERT INTO finance.source_record (tenant_id, unit_id, batch_id, dataset_kind, category, locator, raw_text)
                    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, batch_id, locator) DO NOTHING
                    """.trimIndent(),
                ).use {
                    it.setObject(1, tenantId)
                    it.setObject(2, record.unitId)
                    it.setObject(3, batchId)
                    it.setString(4, record.datasetKind)
                    it.setString(5, record.category)
                    it.setString(6, record.locator)
                    it.setString(7, record.rawText)
                    it.executeUpdate()
                }
            connection
                .prepareStatement(
                    "SELECT id, raw_text, category FROM finance.source_record WHERE tenant_id = ? AND batch_id = ? AND locator = ?",
                ).use {
                    it.setObject(1, tenantId)
                    it.setObject(2, batchId)
                    it.setString(3, record.locator)
                    it.executeQuery().use { result ->
                        result.next()
                        if (result.getString("raw_text") != record.rawText ||
                            result.getString("category") != record.category
                        ) {
                            throw SourceConflict()
                        }
                        result.getObject("id", UUID::class.java)
                    }
                }
        }

    override fun positions(): List<TitlePosition> =
        translateFailure {
            connection
                .prepareStatement(
                    """
                    SELECT id, unit_id, direction, party_name, due_on, currency,
                        original_amount_minor, current_amount_minor, outstanding_minor
                    FROM finance.title_position ORDER BY id
                    """.trimIndent(),
                ).use {
                    it.executeQuery().use { result ->
                        buildList {
                            while (result.next()) {
                                add(
                                    TitlePosition(
                                        result.getObject("id", UUID::class.java),
                                        result.getObject("unit_id", UUID::class.java),
                                        result.getString("direction"),
                                        result.getString("party_name"),
                                        result.getObject("due_on", LocalDate::class.java),
                                        result.getString("currency"),
                                        result.getLong("original_amount_minor"),
                                        result.getLong("current_amount_minor"),
                                        result.getLong("outstanding_minor"),
                                    ),
                                )
                            }
                        }
                    }
                }
        }
}

private fun <T> translateFailure(work: () -> T): T =
    try {
        work()
    } catch (error: SQLException) {
        throw FinanceStorageFailure(error)
    }
