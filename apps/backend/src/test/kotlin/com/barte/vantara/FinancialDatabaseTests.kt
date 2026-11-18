package com.barte.vantara

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.testcontainers.postgresql.PostgreSQLContainer
import java.sql.Connection
import java.sql.DriverManager
import java.sql.SQLException

class FinancialDatabaseTests {
    @Test
    fun `shared account associations enforce unit account and tenant scope`() {
        session("admin", "a") { connection ->
            connection.createStatement().execute("SELECT finance.register_unit(md5('a')::uuid, 'Shared destination')")
            val units = "ARRAY[md5('a-unit')::uuid,(SELECT id FROM finance.business_unit WHERE name='Shared destination')]"
            connection.createStatement().execute("SELECT finance.set_account_units(md5('a')::uuid, md5('account')::uuid, $units)")
            assertEquals(2, count(connection, "finance.bank_account_unit WHERE account_id=md5('account')::uuid"))
            assertDenied(connection, "UPDATE finance.bank_account_unit SET active=false")
            assertDenied(connection, "DELETE FROM finance.bank_account_unit")
            assertDenied(
                connection,
                "INSERT INTO finance.bank_account_unit VALUES (md5('a')::uuid,md5('a-other')::uuid,md5('account')::uuid,'BRL',true)",
            )
            assertDenied(connection, "SELECT finance.set_account_units(md5('a')::uuid, md5('account')::uuid, ARRAY[]::uuid[])")
            assertDenied(connection, "SELECT finance.set_account_units(md5('a')::uuid, md5('account')::uuid, ARRAY[NULL]::uuid[])")
            assertDenied(connection, "SELECT finance.set_account_units(md5('a')::uuid, md5('account')::uuid, ARRAY[md5('b-unit')::uuid])")
            assertDenied(connection, "SELECT finance.set_account_units(md5('b')::uuid, md5('account')::uuid, $units)")
            identity(connection, "ar")
            assertEquals(1, count(connection, "finance.bank_account_unit WHERE account_id=md5('account')::uuid"))
            assertEquals(1, count(connection, "finance.bank_account"))
            assertDenied(connection, "SELECT finance.set_account_units(md5('a')::uuid, md5('account')::uuid, ARRAY[md5('a-unit')::uuid])")
            identity(connection, "admin")
            connection.createStatement().execute(
                "SELECT finance.set_account_units(md5('a')::uuid, md5('account')::uuid, ARRAY[md5('a-unit')::uuid])",
            )
            assertEquals(1, count(connection, "finance.bank_account_unit WHERE account_id=md5('account')::uuid AND active"))
            assertEquals(2, count(connection, "finance.bank_account_unit WHERE account_id=md5('account')::uuid"))
        }
    }

    @Test
    fun `ingestion RLS protects staged files rows scopes and audit from other identities`() {
        session("ar", "a") { connection ->
            connection.createStatement().execute(
                "INSERT INTO finance.ingestion (tenant_id,id,filename,dataset_kind,object_key) VALUES (md5('a')::uuid,md5('upload')::uuid,'original.csv','receivable','a/original')",
            )
            connection.createStatement().execute(
                "INSERT INTO finance.ingestion_row (tenant_id,ingestion_id,row_number,cells) VALUES (md5('a')::uuid,md5('upload')::uuid,2,'[\"private\"]')",
            )
            connection.createStatement().execute(
                "UPDATE finance.ingestion_row SET state='rejected',error='test' WHERE ingestion_id=md5('upload')::uuid",
            )
            assertEquals(1, count(connection, "finance.ingestion"))
            assertDenied(connection, "UPDATE finance.ingestion SET object_key='another-tenant/file'")
            assertDenied(connection, "UPDATE finance.ingestion_row SET cells='[]'")
            assertDenied(
                connection,
                "INSERT INTO finance.ingestion_scope VALUES (md5('a')::uuid,md5('upload')::uuid,md5('a-other')::uuid,NULL)",
            )
            assertDenied(
                connection,
                "INSERT INTO finance.ingestion (tenant_id,id,filename,dataset_kind,object_key) VALUES (md5('b')::uuid,gen_random_uuid(),'x','receivable','x')",
            )
            connection.createStatement().execute(
                "INSERT INTO finance.ingestion_scope VALUES (md5('a')::uuid,md5('upload')::uuid,md5('a-unit')::uuid,NULL)",
            )
            identity(connection, "admin")
            for (table in listOf("ingestion", "ingestion_row", "ingestion_scope")) assertEquals(0, count(connection, "finance.$table"))
            assertEquals(0, count(connection, "finance.audit_detail WHERE table_name IN ('ingestion','ingestion_row')"))
            assertDenied(
                connection,
                "INSERT INTO finance.ingestion_row (tenant_id,ingestion_id,row_number,cells) VALUES (md5('a')::uuid,md5('upload')::uuid,3,'[]')",
            )
            assertDenied(
                connection,
                "INSERT INTO finance.ingestion (tenant_id,id,filename,dataset_kind,object_key) VALUES (md5('a')::uuid,gen_random_uuid(),'x','receivable','x')",
            )
        }
    }

    @Test
    fun `unit registration cannot adopt an existing hidden unit or mint foreign tenant scope`() {
        session("ar", "a") { connection ->
            connection.createStatement().execute("SELECT finance.register_unit(md5('a')::uuid, 'New unit')")
            assertEquals(2, count(connection, "finance.business_unit"))
            assertDenied(connection, "SELECT finance.register_unit(md5('b')::uuid, 'Foreign')")
            assertDenied(connection, "SELECT finance.register_unit(md5('a')::uuid, '')")
            assertDenied(connection, "SELECT finance.register_unit(md5('a')::uuid, 'New unit')")
            identity(connection, "fpa")
            assertDenied(connection, "SELECT finance.register_unit(md5('a')::uuid, 'Forbidden')")
        }
    }

    @Test
    fun `bank account revocation hides entries raw evidence allocations and audit payloads`() {
        session("reconciliation", "a") { connection ->
            assertEquals(1, count(connection, "finance.bank_account"))
            proposal(connection, "account-revocation")
            allocation(connection, "account-revocation", "bela", "bela-bank", 100)
            identity(connection, "admin")
            assertEquals(
                1,
                connection.createStatement().executeUpdate(
                    "DELETE FROM finance.member_bank_account WHERE member_id = md5('a-reconciliation')::uuid",
                ),
            )
            identity(connection, "reconciliation")
            for (table in listOf("bank_account", "bank_entry", "bank_balance", "allocation", "reconciliation_decision")) {
                assertEquals(0, count(connection, "finance.$table"), table)
            }
            assertEquals(0, count(connection, "finance.source_record WHERE dataset_kind = 'bank'"))
            assertEquals(0, count(connection, "finance.audit_detail WHERE category IN ('bank', 'incoming_bank', 'reconcile')"))
            assertDenied(
                connection,
                "INSERT INTO finance.member_bank_account VALUES (md5('a')::uuid, md5('a-reconciliation')::uuid, md5('a-unit')::uuid, md5('account')::uuid)",
            )
            assertDenied(connection, reviewSql("account-revocation"))
        }
    }

    @Test
    fun `technical admins cannot expand their own authority or delegate units they do not manage`() {
        session("admin", "a") { connection ->
            assertDenied(connection, "INSERT INTO finance.member_role VALUES (md5('a')::uuid, md5('a-admin')::uuid, 'ap')")
            assertDenied(connection, "INSERT INTO finance.member_unit VALUES (md5('a')::uuid, md5('a-ap')::uuid, md5('a-other')::uuid)")
            assertDenied(
                connection,
                "INSERT INTO finance.approval_scope VALUES (md5('a')::uuid, md5('a-admin')::uuid, md5('a-unit')::uuid, 'approve_payable')",
            )
            assertEquals(
                0,
                connection.createStatement().executeUpdate("DELETE FROM finance.member_role WHERE member_id = md5('a-admin')::uuid"),
            )
            assertEquals(1, count(connection, "finance.business_unit"))
            assertEquals(0, count(connection, "finance.bank_entry"))
            assertEquals(0, count(connection, "finance.title"))
        }
    }

    @Test
    fun `AR can propose incoming matches but cannot approve them and controllership cannot create AP drafts`() {
        session("ar", "a") { connection ->
            proposal(connection, "ar-proposal")
            allocation(connection, "ar-proposal", "bela", "bela-bank", 100)
            assertDenied(connection, reviewSql("ar-proposal"))
            identity(connection, "controllership")
            assertEquals(
                0,
                connection.createStatement().executeUpdate("UPDATE finance.title SET current_amount_minor = 1 WHERE direction = 'payable'"),
            )
        }
    }

    @Test
    fun `approval rejects a payable changed after submission and ignores message approval text`() {
        session("ap", "a") { connection ->
            assertEquals(0, count(connection, "finance.payable_review"))
            assertEquals(1, count(connection, "finance.source_record WHERE raw_text LIKE '%ok, aprovado%'"))
            connection.createStatement().execute(
                """
                INSERT INTO finance.payable_submission (tenant_id, unit_id, id, title_id, origin)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('stale-submission')::uuid, md5('bill')::uuid, 'human')
                """.trimIndent(),
            )
            connection.createStatement().execute(
                """
                UPDATE finance.title SET current_amount_minor = 1927800, latest_source_id = md5('bill-update-source')::uuid
                WHERE id = md5('bill')::uuid
                """.trimIndent(),
            )
            identity(connection, "approver")
            assertDenied(
                connection,
                """
                INSERT INTO finance.payable_review (tenant_id, unit_id, submission_id, decision, reason)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('stale-submission')::uuid, 'approved', 'stale')
                """.trimIndent(),
            )
        }
    }

    @Test
    fun `migrations run and repeat under a non superuser provisioning owner`() {
        PostgreSQLContainer("postgres:17-alpine").use { database ->
            database.start()
            DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
                connection.createStatement().execute(
                    "CREATE ROLE migration_owner LOGIN PASSWORD 'migrationTestOnly' CREATEROLE NOSUPERUSER NOBYPASSRLS",
                )
                connection.createStatement().execute("ALTER DATABASE ${database.databaseName} OWNER TO migration_owner")
            }
            val configuration =
                Flyway
                    .configure()
                    .dataSource(database.jdbcUrl, "migration_owner", "migrationTestOnly")
                    .placeholders(mapOf("appPassword" to "testRuntimePassword"))
            assertEquals(
                12,
                configuration
                    .target("12")
                    .load()
                    .migrate()
                    .migrationsExecuted,
            )
            DriverManager.getConnection(database.jdbcUrl, "migration_owner", "migrationTestOnly").use { connection ->
                connection.createStatement().execute(
                    FinancialDatabaseTests::class.java.getResource("/database/authorization.sql")!!.readText(),
                )
                connection.createStatement().execute(
                    FinancialDatabaseTests::class.java.getResource("/database/financial-fixtures.sql")!!.readText(),
                )
            }
            val flyway = configuration.target("latest").load()
            assertEquals(2, flyway.migrate().migrationsExecuted)
            assertEquals(0, flyway.migrate().migrationsExecuted)
            DriverManager.getConnection(database.jdbcUrl, "migration_owner", "migrationTestOnly").use { connection ->
                assertEquals(2, count(connection, "finance.bank_account_unit"))
                assertEquals(
                    0,
                    count(
                        connection,
                        "finance.bank_entry e LEFT JOIN finance.bank_account_unit u USING (tenant_id, unit_id, account_id, currency) WHERE u.account_id IS NULL",
                    ),
                )
                assertTrue(count(connection, "finance.bank_entry") > 0)
                assertEquals(
                    0,
                    count(
                        connection,
                        "pg_class WHERE oid='finance.bank_account_unit'::regclass AND NOT (relrowsecurity AND relforcerowsecurity)",
                    ),
                )
            }
            DriverManager.getConnection(database.jdbcUrl, "app_user", "testRuntimePassword").use { connection ->
                assertEquals(0, count(connection, "finance.title"))
            }
        }
    }

    @Test
    fun `operational records obey team boundaries and bank balances require sourced snapshots`() {
        session("ar", "a") { connection ->
            val collection =
                """
                INSERT INTO finance.collection_case (tenant_id, unit_id, title_id, note)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('bela')::uuid, 'Investigate partial payment')
                """.trimIndent()
            connection.createStatement().execute(collection)
            identity(connection, "ap")
            assertEquals(0, count(connection, "finance.collection_case"))
            assertDenied(connection, collection)
            identity(connection, "controllership")
            connection.createStatement().execute(
                """
                INSERT INTO finance.close_exception (tenant_id, unit_id, period_end, source_id, note)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, '2026-07-31', md5('bill-update-source')::uuid, 'Unresolved supplier update')
                """.trimIndent(),
            )
            assertEquals(1, count(connection, "finance.close_exception"))
            identity(connection, "fpa")
            assertEquals(0, count(connection, "finance.close_exception"))
            identity(connection, "admin")
            connection.createStatement().execute(
                """
                INSERT INTO finance.integration_metadata (tenant_id, unit_id, provider)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, 'protheus')
                """.trimIndent(),
            )
            assertEquals(1, connection.createStatement().executeUpdate("UPDATE finance.integration_metadata SET enabled = true"))
            assertEquals(1, connection.createStatement().executeUpdate("DELETE FROM finance.integration_metadata"))
            assertDenied(
                connection,
                """
                INSERT INTO finance.integration_metadata (tenant_id, unit_id, provider)
                VALUES (md5('b')::uuid, md5('b-unit')::uuid, 'protheus')
                """.trimIndent(),
            )
        }
    }

    @Test
    fun `unallocated credit remains visible instead of forcing an overpayment into a title`() {
        session("reconciliation", "a") { connection ->
            proposal(connection, "unallocated-credit")
            allocation(connection, "unallocated-credit", "doce-product", "doce-bank", 4278050)
            identity(connection, "reviewer")
            confirm(connection, "unallocated-credit")
            identity(connection, "ar")
            connection
                .createStatement()
                .executeQuery(
                    "SELECT unallocated_minor FROM finance.bank_position WHERE id = md5('doce-bank')::uuid",
                ).use {
                    it.next()
                    assertEquals(485000, it.getLong(1))
                }
            assertEquals(0, count(connection, "finance.bank_balance"))
        }
    }

    @Test
    fun `FPA reads only independently published aggregates and scoped forecasts`() {
        session("controllership", "a") { connection ->
            connection.createStatement().execute(
                """
                INSERT INTO finance.financial_summary (tenant_id, unit_id, id, period_end, metric, amount_minor, currency)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('summary')::uuid, '2026-07-31', 'expected_inflow', 4763050, 'BRL')
                """.trimIndent(),
            )
            identity(connection, "fpa")
            assertEquals(0, count(connection, "finance.financial_summary"))
            connection.createStatement().execute(
                """
                INSERT INTO finance.forecast (tenant_id, unit_id, period_end, direction, amount_minor, currency)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, '2026-08-31', 'inflow', 1000, 'JPY')
                """.trimIndent(),
            )
            assertEquals(1, count(connection, "finance.forecast"))
            val publish =
                """
                INSERT INTO finance.summary_publication (tenant_id, unit_id, summary_id)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('summary')::uuid)
                """.trimIndent()
            assertDenied(connection, publish)
            identity(connection, "admin")
            assertDenied(connection, publish)
            assertEquals(0, count(connection, "finance.forecast"))
            identity(connection, "reviewer")
            connection.createStatement().execute(publish)
            identity(connection, "fpa")
            assertEquals(1, count(connection, "finance.financial_summary"))
            assertEquals(0, count(connection, "finance.source_processing"))
            assertDenied(
                connection,
                "INSERT INTO finance.forecast (tenant_id, unit_id, period_end, direction, amount_minor, currency) VALUES (md5('a')::uuid, md5('a-unit')::uuid, '2026-08-31', 'inflow', 1, 'XYZ')",
            )
        }
    }

    @Test
    fun `currency definitions and bank dates remain distinct and unknown parties stay unknown`() {
        session("reconciliation", "a") { connection ->
            connection
                .createStatement()
                .executeQuery(
                    "SELECT minor_unit FROM finance.currency WHERE code IN ('JPY', 'KWD', 'BRL') ORDER BY code",
                ).use {
                    val units = buildList { while (it.next()) add(it.getInt(1)) }
                    assertEquals(listOf(2, 0, 3), units)
                }
            connection
                .createStatement()
                .executeQuery(
                    "SELECT amount_minor, booking_date, value_date, counterparty_name FROM finance.bank_entry WHERE id = md5('bill-bank')::uuid",
                ).use {
                    it.next()
                    assertEquals(1890000, it.getLong(1))
                    assertEquals("2026-07-20", it.getDate(2).toString())
                    assertEquals(null, it.getDate(3))
                    assertEquals(null, it.getString(4))
                }
            assertEquals(0, count(connection, "finance.bank_balance"))
            assertEquals(3, count(connection, "finance.bank_position WHERE unallocated_minor = amount_minor"))
        }
    }

    @Test
    fun `reviewed proposals cannot be self reviewed even with explicit approval scope`() {
        session("reviewer", "a") { connection ->
            proposal(connection, "self-review")
            allocation(connection, "self-review", "bela", "bela-bank", 100)
            assertDenied(connection, reviewSql("self-review"))
        }
    }

    @Test
    fun `source processing preserves AI interpretation and unresolved exceptions separately from raw evidence`() {
        session("ap", "a") { connection ->
            identity(connection, "ap", "ai")
            connection.createStatement().execute(
                """
                INSERT INTO finance.source_review (tenant_id, unit_id, source_id, state, interpretation, exceptions, origin)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('bill-update-source')::uuid, 'needs_review',
                    '{"amount_minor":1927800,"currency":"BRL","observation_state":"suggested"}',
                    '["possible duplicate NF 88231", "partial delivery", "contradictory payment chronology"]', 'ai')
                """.trimIndent(),
            )
            connection.createStatement().execute(
                """
                INSERT INTO finance.title (tenant_id, unit_id, id, direction, party_name, currency, original_amount_minor,
                    current_amount_minor, observation_state, source_id, latest_source_id)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('updated-claim')::uuid, 'payable', 'Sao Jorge Embalagens',
                    'BRL', 1890000, 1927800, 'suggested', md5('bill-update-source')::uuid, md5('bill-update-source')::uuid)
                """.trimIndent(),
            )
            connection.createStatement().execute(
                """
                INSERT INTO finance.payable_evidence (tenant_id, unit_id, title_id, source_id, possible_duplicate_id, interpretation, origin)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('updated-claim')::uuid, md5('bill-update-source')::uuid,
                    md5('bill')::uuid, '{"relationship":"possible repeated claim, not confirmed"}', 'ai')
                """.trimIndent(),
            )
            assertEquals(
                1,
                count(
                    connection,
                    "finance.source_processing WHERE processing_state = 'needs_review' AND jsonb_array_length(unresolved_exceptions) = 3",
                ),
            )
            assertEquals(1, count(connection, "finance.payable_evidence WHERE origin = 'ai'"))
            assertDenied(
                connection,
                """
                INSERT INTO finance.source_review (tenant_id, unit_id, source_id, state, origin)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('bill-update-source')::uuid, 'verified', 'human')
                """.trimIndent(),
            )
            identity(connection, "robot")
            assertDenied(
                connection,
                """
                INSERT INTO finance.source_review (tenant_id, unit_id, source_id, state, origin)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('bill-update-source')::uuid, 'verified', 'human')
                """.trimIndent(),
            )
        }
    }

    @Test
    fun `all tenant tables force RLS and runtime cannot become a function owner`() {
        DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
            assertEquals(
                0,
                count(
                    connection,
                    "pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'finance' AND c.relkind = 'r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)",
                ),
            )
            assertEquals(0, count(connection, "pg_roles WHERE rolname IN ('app_user', 'finance_guard') AND (rolsuper OR rolbypassrls)"))
            assertEquals(0, count(connection, "pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'app_user'"))
            connection
                .createStatement()
                .executeQuery(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'finance' AND tablename NOT IN ('role_permission', 'currency')",
                ).use { tables ->
                    session("unknown", "a") { runtime ->
                        while (tables.next()) assertEquals(0, count(runtime, "finance.${tables.getString(1)}"), tables.getString(1))
                        assertDenied(runtime, "SET ROLE finance_guard")
                        assertDenied(runtime, "TRUNCATE finance.source_record CASCADE")
                    }
                }
        }
    }

    @Test
    fun `tenant selection is explicit and membership must be active`() {
        session("ap", "a") { assertEquals(1, count(it, "finance.tenant")) }
        session("ap", "b") { assertEquals(0, count(it, "finance.tenant")) }
        session("inactive", "a") { assertEquals(0, count(it, "finance.tenant")) }
        session("unknown", "a") { assertEquals(0, count(it, "finance.tenant")) }
        session("shared", "a") { assertEquals(1, count(it, "finance.tenant")) }
        session("shared", "b") { assertEquals(1, count(it, "finance.tenant")) }
        session("ap", "a", issuer = "wrong") { assertEquals(0, count(it, "finance.tenant")) }
    }

    @Test
    fun `source records are immutable and reimport uses a stable source locator`() {
        session("ar", "a") { connection ->
            val sql =
                """
                INSERT INTO finance.source_record (tenant_id, unit_id, id, batch_id, locator, raw_text)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('row')::uuid,
                    md5('batch-protheus')::uuid, 'line:4', 'Doce Ponto Comercio de Alimentos;98.765.432/0001-11;SP-Interior;NF 104533;000012345690;Produto;02/07/2026;12/07/2026;42.780,50;Aberto')
                ON CONFLICT (tenant_id, batch_id, locator) DO NOTHING
                """.trimIndent()
            assertEquals(0, connection.createStatement().executeUpdate(sql))
            assertEquals(0, connection.createStatement().executeUpdate(sql))
            assertDenied(connection, "UPDATE finance.source_record SET raw_text = 'rewritten'")
        }
    }

    @Test
    fun `payable submission cannot be self approved or approved by an AI`() {
        session("ap", "a") { connection ->
            connection.createStatement().execute(
                """
                INSERT INTO finance.payable_submission (tenant_id, unit_id, id, title_id, origin)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('submission')::uuid, md5('bill')::uuid, 'human')
                """.trimIndent(),
            )
            val review =
                """
                INSERT INTO finance.payable_review (tenant_id, unit_id, submission_id, decision, reason)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('submission')::uuid, 'approved', 'self')
                """.trimIndent()
            assertDenied(connection, review)
            identity(connection, "admin")
            assertDenied(connection, review)
            identity(connection, "robot")
            assertDenied(connection, review)
            identity(connection, "approver", "ai")
            assertDenied(connection, review)
            identity(connection, "approver")
            connection.createStatement().execute(review)
            assertEquals(1, count(connection, "finance.payable_review"))
            assertDenied(connection, "UPDATE finance.payable_review SET decision = 'rejected'")
        }
    }

    @Test
    fun `six role boundaries and unit scope apply to raw data and views`() {
        val expected =
            mapOf(
                "ap" to listOf(1, 0, 3),
                "ar" to listOf(5, 2, 7),
                "reconciliation" to listOf(6, 3, 11),
                "controllership" to listOf(6, 3, 11),
                "fpa" to listOf(0, 0, 0),
                "admin" to listOf(0, 0, 0),
            )
        expected.forEach { (role, counts) ->
            session(role, "a") { connection ->
                assertEquals(counts[0], count(connection, "finance.title"), role)
                assertEquals(counts[0], count(connection, "finance.title_position"), role)
                assertEquals(counts[1], count(connection, "finance.bank_entry"), role)
                assertEquals(counts[2], count(connection, "finance.source_record"), role)
                assertEquals(0, count(connection, "finance.title WHERE unit_id = md5('a-other')::uuid"))
                assertEquals(0, count(connection, "finance.title WHERE tenant_id = md5('b')::uuid"))
            }
        }
        session("admin", "a") {
            assertEquals(1, count(it, "finance.bank_account"))
            assertEquals(0, count(it, "finance.bank_account WHERE unit_id = md5('a-other')::uuid"))
            assertEquals(0, count(it, "finance.bank_account WHERE tenant_id = md5('b')::uuid"))
            assertEquals(0, count(it, "finance.audit_detail WHERE category <> 'configure'"))
            assertTrue(count(it, "finance.audit_metadata") > 0)
            assertTrue(count(it, "finance.import_batch") > 0)
        }
    }

    @Test
    fun `tenant A cannot insert update delete or link tenant B records`() {
        session("ar", "a") { connection ->
            assertEquals(
                0,
                connection.createStatement().executeUpdate("UPDATE finance.title SET status = 'disputed' WHERE tenant_id = md5('b')::uuid"),
            )
            assertDenied(connection, "DELETE FROM finance.title WHERE tenant_id = md5('b')::uuid")
            assertDenied(
                connection,
                """
                INSERT INTO finance.source_record (tenant_id, unit_id, batch_id, locator, raw_text)
                VALUES (md5('b')::uuid, md5('b-unit')::uuid, md5('b-batch')::uuid, 'attack', 'attack')
                """.trimIndent(),
            )
            assertDenied(connection, "UPDATE finance.title SET latest_source_id = md5('b-source')::uuid WHERE id = md5('grao')::uuid")
        }
        DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use { connection ->
            connection.autoCommit = false
            assertDenied(connection, "UPDATE finance.title SET latest_source_id = md5('b-source')::uuid WHERE id = md5('grao')::uuid")
            connection.rollback()
        }
        session("admin", "a") { connection ->
            assertEquals(0, connection.createStatement().executeUpdate("DELETE FROM finance.member_role WHERE tenant_id = md5('b')::uuid"))
            assertDenied(
                connection,
                "INSERT INTO finance.approval_scope VALUES (md5('a')::uuid, md5('a-admin')::uuid, md5('a-unit')::uuid, 'approve_payable')",
            )
        }
    }

    @Test
    fun `confirmed allocations support grouped and partial settlement and freeze reviewed proposals`() {
        session("reconciliation", "a") { connection ->
            proposal(connection, "grouped")
            allocation(connection, "grouped", "doce-product", "doce-bank", 4278050)
            allocation(connection, "grouped", "doce-royalty", "doce-bank", 485000)
            proposal(connection, "partial")
            allocation(connection, "partial", "bela", "bela-bank", 6250000)
            identity(connection, "reviewer")
            confirm(connection, "grouped")
            confirm(connection, "partial")
            identity(connection, "ar")
            connection
                .createStatement()
                .executeQuery(
                    "SELECT outstanding_minor FROM finance.title_position WHERE id = md5('bela')::uuid",
                ).use {
                    it.next()
                    assertEquals(6250000, it.getLong(1))
                }
            assertEquals(2, count(connection, "finance.title_position WHERE outstanding_minor = 0"))
            identity(connection, "reconciliation")
            assertDenied(connection, allocationSql("partial", "grao", "bela-bank", 1))
            proposal(connection, "overallocated")
            allocation(connection, "overallocated", "grao", "bela-bank", 1)
            identity(connection, "reviewer")
            assertDenied(connection, reviewSql("overallocated"))
        }
    }

    @Test
    fun `conflicting and many to many suggestions remain unconfirmed`() {
        session("reconciliation", "a") { connection ->
            proposal(connection, "ambiguous", "ai")
            allocation(connection, "ambiguous", "grao", "doce-bank", 100)
            allocation(connection, "ambiguous", "grao", "bela-bank", 100)
            allocation(connection, "ambiguous", "grao-omie", "doce-bank", 100)
            assertEquals(3, count(connection, "finance.allocation"))
            assertEquals(2, count(connection, "finance.title WHERE original_amount_minor = 3125000"))
            assertEquals(0, count(connection, "finance.reconciliation_review"))
            assertEquals(0, count(connection, "finance.bank_balance"))
            assertDenied(connection, reviewSql("ambiguous"))
            proposal(connection, "wrong-direction")
            allocation(connection, "wrong-direction", "grao", "bill-bank", 100)
            identity(connection, "reviewer")
            assertDenied(connection, reviewSql("wrong-direction"))
        }
    }

    @Test
    fun `transaction local context clears on commit and rollback on a reused connection`() {
        session("shared", "a") { connection ->
            assertEquals(5, count(connection, "finance.title"))
            connection.commit()
            assertEquals(0, count(connection, "finance.title"))
            connection.createStatement().execute(
                "SELECT set_config('app.tenant', md5('b')::uuid::text, true), set_config('app.issuer', 'https://cognito.example/pool', true)",
            )
            identity(connection, "shared")
            assertEquals(1, count(connection, "finance.title"))
            connection.rollback()
            assertEquals(0, count(connection, "finance.title"))
            connection.createStatement().execute("SELECT set_config('app.tenant', 'not-a-uuid', true)")
            assertEquals(0, count(connection, "finance.title"))
        }
    }

    @Test
    fun `normalization changes keep both evidence and an immutable audit trail`() {
        session("ap", "a") { connection ->
            connection.createStatement().execute(
                """
                UPDATE finance.title SET current_amount_minor = 1927800, due_on = '2026-07-25',
                    latest_source_id = md5('bill-update-source')::uuid WHERE id = md5('bill')::uuid
                """.trimIndent(),
            )
            connection
                .createStatement()
                .executeQuery(
                    """
                    SELECT original_amount_minor, current_amount_minor FROM finance.title WHERE id = md5('bill')::uuid
                    """.trimIndent(),
                ).use {
                    it.next()
                    assertEquals(1890000, it.getLong(1))
                    assertEquals(1927800, it.getLong(2))
                }
            assertEquals(1, count(connection, "finance.audit_detail WHERE table_name = 'title' AND operation = 'UPDATE'"))
            assertEquals(3, count(connection, "finance.source_record WHERE category = 'payable'"))
            assertDenied(connection, "DELETE FROM finance.audit_detail")
        }
    }

    @Test
    fun `missing identity and inactive membership fail closed`() {
        DriverManager.getConnection(postgres.jdbcUrl, "app_user", "testRuntimePassword").use { connection ->
            connection.createStatement().executeQuery("SELECT count(*) FROM finance.tenant").use {
                it.next()
                assertEquals(0, it.getInt(1))
            }
        }
    }

    companion object {
        val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }

        init {
            Flyway
                .configure()
                .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
                .placeholders(mapOf("appPassword" to "testRuntimePassword"))
                .load()
                .migrate()
            DriverManager.getConnection(postgres.jdbcUrl, postgres.username, postgres.password).use {
                it.createStatement().execute(FinancialDatabaseTests::class.java.getResource("/database/authorization.sql")!!.readText())
                it.createStatement().execute(
                    FinancialDatabaseTests::class.java.getResource("/database/financial-fixtures.sql")!!.readText(),
                )
            }
        }

        fun count(
            connection: Connection,
            table: String,
        ): Int =
            connection.createStatement().executeQuery("SELECT count(*) FROM $table").use {
                it.next()
                it.getInt(1)
            }

        fun assertDenied(
            connection: Connection,
            sql: String,
        ) {
            val savepoint = connection.setSavepoint()
            val error = assertThrows(SQLException::class.java) { connection.createStatement().execute(sql) }
            assertTrue(error.sqlState in setOf("42501", "23503", "23514", "23505"), "Unexpected denial: ${error.message}")
            connection.rollback(savepoint)
        }

        fun identity(
            connection: Connection,
            subject: String,
            origin: String = "human",
        ) {
            connection.prepareStatement("SELECT set_config('app.subject', ?, true), set_config('app.actor_kind', ?, true)").use {
                it.setString(1, subject)
                it.setString(2, origin)
                it.execute()
            }
        }

        fun proposal(
            connection: Connection,
            key: String,
            origin: String = "human",
        ) {
            connection.createStatement().execute(
                """
                INSERT INTO finance.reconciliation_decision (tenant_id, unit_id, id, origin, rationale)
                VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('$key')::uuid, '$origin', 'Test hypothesis, not sample truth')
                """.trimIndent(),
            )
        }

        fun allocationSql(
            decision: String,
            title: String,
            bank: String,
            amount: Long,
        ): String =
            """
            INSERT INTO finance.allocation (tenant_id, unit_id, decision_id, title_id, bank_entry_id, amount_minor, currency)
            VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('$decision')::uuid, md5('$title')::uuid, md5('$bank')::uuid, $amount, 'BRL')
            """.trimIndent()

        fun allocation(
            connection: Connection,
            decision: String,
            title: String,
            bank: String,
            amount: Long,
        ) {
            connection.createStatement().execute(allocationSql(decision, title, bank, amount))
        }

        fun reviewSql(key: String): String =
            """
            INSERT INTO finance.reconciliation_review (tenant_id, unit_id, decision_id, decision, reason)
            VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('$key')::uuid, 'confirmed', 'Synthetic test approval')
            """.trimIndent()

        fun confirm(
            connection: Connection,
            key: String,
        ) {
            connection.createStatement().execute(reviewSql(key))
        }

        fun session(
            subject: String,
            tenant: String,
            issuer: String = "https://cognito.example/pool",
            block: (Connection) -> Unit,
        ) {
            DriverManager.getConnection(postgres.jdbcUrl, "app_user", "testRuntimePassword").use { connection ->
                connection.autoCommit = false
                connection
                    .prepareStatement(
                        "SELECT set_config('app.issuer', ?, true), set_config('app.subject', ?, true), " +
                            "set_config('app.tenant', md5(?)::uuid::text, true), set_config('app.actor_kind', 'human', true)",
                    ).use {
                        it.setString(1, issuer)
                        it.setString(2, subject)
                        it.setString(3, tenant)
                        it.execute()
                    }
                try {
                    block(connection)
                } finally {
                    connection.rollback()
                }
            }
        }
    }
}
