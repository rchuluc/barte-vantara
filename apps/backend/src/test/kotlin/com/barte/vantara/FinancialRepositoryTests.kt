package com.barte.vantara

import com.barte.vantara.finance.FinanceAccessDenied
import com.barte.vantara.finance.FinanceStorageFailure
import com.barte.vantara.finance.IngestionRecord
import com.barte.vantara.finance.SourceConflict
import com.barte.vantara.finance.VerifiedFinanceContext
import com.barte.vantara.finance.postgres.PostgresFinanceStore
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.postgresql.PostgreSQLContainer
import java.sql.DriverManager
import java.util.UUID

class FinancialRepositoryTests {
    private val store = PostgresFinanceStore(DriverManagerDataSource(postgres.jdbcUrl, "app_user", "testRuntimePassword"))

    @Test
    fun `repository ingests one versioned envelope and retrieves only scoped positions`() {
        val record =
            IngestionRecord(id("a-unit"), "manual", "test-artifact", "v1", 1, "receivable", "receivable", "line:1", "unparsed original")
        val first =
            store.transaction(context("ar")) { repository ->
                assertEquals(5, repository.positions().size)
                repository.ingest(record)
            }
        assertEquals(first, store.transaction(context("ar")) { it.ingest(record) })
        assertThrows(FinanceAccessDenied::class.java) {
            store.transaction(context("inactive")) { it.positions() }
        }
    }

    @Test
    fun `conflicting retries are rejected and failures roll back the entire envelope`() {
        val record = IngestionRecord(id("a-unit"), "manual", "conflict-test", "v1", 1, "receivable", "receivable", "line:1", "original")
        store.transaction(context("reconciliation")) { it.ingest(record) }
        assertThrows(SourceConflict::class.java) {
            store.transaction(context("reconciliation")) { it.ingest(record.copy(rawText = "changed")) }
        }
        assertThrows(SourceConflict::class.java) {
            store.transaction(context("reconciliation")) { it.ingest(record.copy(datasetKind = "payable", category = "payable")) }
        }
        val bank = record.copy(artifactRef = "bank-conflict", datasetKind = "bank", category = "incoming_bank")
        store.transaction(context("reconciliation")) { it.ingest(bank) }
        assertThrows(SourceConflict::class.java) {
            store.transaction(context("reconciliation")) { it.ingest(bank.copy(category = "bank")) }
        }
        assertThrows(FinanceStorageFailure::class.java) {
            store.transaction(context("ar")) { it.ingest(record.copy(contractVersion = 2)) }
        }
        assertThrows(FinanceStorageFailure::class.java) {
            store.transaction(context("ar")) { it.ingest(record.copy(artifactRef = "invalid-category", category = "payable")) }
        }
        assertThrows(IllegalStateException::class.java) {
            store.transaction(context("ar")) {
                it.ingest(record.copy(artifactRef = "rolled-back"))
                error("downstream normalization failed")
            }
        }
        DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
            assertEquals(
                0,
                FinancialDatabaseTests.count(connection, "finance.import_batch WHERE object_ref IN ('rolled-back', 'invalid-category')"),
            )
        }
        assertEquals(emptyList<Any>(), store.transaction(context("admin")) { it.positions() })
    }

    private fun context(subject: String): VerifiedFinanceContext =
        VerifiedFinanceContext("https://cognito.example/pool", subject, id("a"), "human")

    private fun id(label: String): UUID =
        DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
            connection.prepareStatement("SELECT md5(?)::uuid").use {
                it.setString(1, label)
                it.executeQuery().use { result ->
                    result.next()
                    result.getObject(1, UUID::class.java)
                }
            }
        }

    companion object {
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }

        init {
            Flyway
                .configure()
                .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
                .placeholders(mapOf("appPassword" to "testRuntimePassword"))
                .load()
                .migrate()
            DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
                listOf("authorization", "financial-fixtures").forEach {
                    connection.createStatement().execute(FinancialRepositoryTests::class.java.getResource("/database/$it.sql")!!.readText())
                }
            }
        }
    }
}
