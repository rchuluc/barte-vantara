package com.barte.vantara

import com.barte.vantara.users.CognitoProperties
import com.barte.vantara.users.DevelopmentSeed
import com.barte.vantara.users.UserAccess
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
import org.testcontainers.containers.wait.strategy.Wait
import org.testcontainers.postgresql.PostgreSQLContainer
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.util.Properties
import java.util.UUID

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UserManagementTests {
    @Autowired
    private lateinit var access: UserAccess

    @Autowired
    private lateinit var decoder: JwtDecoder

    @Autowired
    private lateinit var runtime: JdbcTemplate

    @Value("\${local.server.port}")
    private var port = 0
    private val http = HttpClient.newHttpClient()
    private val json = JsonMapper.builder().build()

    @Test
    fun `preview reads CSV samples without creating a database import or S3 version`() {
        val token = login("ar")
        val id = UUID.randomUUID()
        val csv = "Name,Due,Total\n" + (1..25).joinToString("\n") { "Customer $it,2026-07-20,10" }
        val preview = body(preview(token, id, "sample.csv", csv.toByteArray()))
        assertEquals(id.toString(), preview["id"].asText())
        assertEquals(25, preview["total"].asInt())
        assertEquals(20, preview["rows"].size())
        assertEquals("custom", preview["platform"].asText())
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM finance.ingestion WHERE id=?", Int::class.java, id))
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM finance.ingestion_row WHERE ingestion_id=?", Int::class.java, id))
        assertTrue(s3.listObjectVersions { it.bucket("vantara-ingestion-local").prefix("$tenant/$id/") }.versions().isEmpty())
        assertEquals(404, request("GET", "/imports/$id", token).statusCode())
        assertEquals(404, request("GET", "/imports/$id/file", token).statusCode())
        val omie = "customer_name,tax_id,invoice_ref,due_date,amount,paid_flag\nAcme,,I1,2026-07-20,10,n"
        assertEquals("omie", body(preview(token, UUID.randomUUID(), "omie.csv", omie.toByteArray()))["platform"].asText())
    }

    @Test
    fun `import search filters names dates states and validates pagination`() {
        val token = login("ap", mcpClient)
        val name = "search-${UUID.randomUUID()}.csv"
        val id = body(upload(token, name, "Name,Due,Total\nSearch Vendor,2026-07-20,12.50", "payable"), 201)["id"].asText()
        val found = body(request("GET", "/imports?name=$name&state=mapping&kind=payable&from=2020-01-01&to=2099-01-01", token))
        assertEquals(listOf(id), found.toList().map { it["id"].asText() }, found.toString())
        assertEquals(0, body(request("GET", "/imports?name=$name&state=completed", token)).size())
        assertEquals(0, body(request("GET", "/imports?name=$name&to=2020-01-01", token)).size())
        assertEquals(0, body(request("GET", "/imports?name=$name", login("fpa", mcpClient))).size())
        for (query in listOf("limit=101", "offset=-1", "from=2027-01-01&to=2026-01-01", "state=unknown")) {
            assertEquals(400, request("GET", "/imports?$query", token).statusCode())
        }
        body(
            request(
                "POST",
                "/imports/$id/confirm",
                token,
                """{"unitId":"$unit","dateFormat":"uuuu-MM-dd","decimal":".","columns":{"party_name":"Name","due_on":"Due","amount":"Total"}}""",
            ),
        )
        body(request("POST", "/imports/$id/process", token))
        assertEquals(1, body(request("GET", "/imports?name=$name&minAmountMinor=1250&maxAmountMinor=1250", token)).size())
        assertEquals(0, body(request("GET", "/imports?name=$name&minAmountMinor=1251", token)).size())
        assertEquals(400, request("GET", "/imports?minAmountMinor=-1", token).statusCode())
    }

    @Test
    fun `preview parses XLSX and never persists rejected or unauthorized previews`() {
        val token = login("ar")
        val bytes = java.io.ByteArrayOutputStream()
        org.apache.poi.xssf.usermodel.XSSFWorkbook().use { book ->
            val sheet = book.createSheet()
            sheet.createRow(0).createCell(0).setCellValue("Name")
            sheet.createRow(1).createCell(0).setCellValue("Acme")
            book.write(bytes)
        }
        assertEquals(1, body(preview(token, UUID.randomUUID(), "sample.xlsx", bytes.toByteArray()))["total"].asInt())
        for ((filename, content) in listOf(
            "empty.csv" to "",
            "blank.csv" to ",Name\n",
            "duplicate.csv" to "Name,Name\n",
            "bad.xlsx" to "invalid",
        )) {
            val id = UUID.randomUUID()
            assertEquals(400, preview(token, id, filename, content.toByteArray()).statusCode())
            assertEquals(0, owner.queryForObject("SELECT count(*) FROM finance.ingestion WHERE id=?", Int::class.java, id))
            assertTrue(s3.listObjectVersions { it.bucket("vantara-ingestion-local").prefix("$tenant/$id/") }.versions().isEmpty())
        }
        for ((name, kind) in listOf("file.pdf" to "receivable", "" to "bank", "file.csv" to "unknown", "a".repeat(201) to "receivable")) {
            assertEquals(400, preview(token, UUID.randomUUID(), name, "Name".toByteArray(), kind).statusCode())
        }
        assertEquals(401, preview(null, UUID.randomUUID(), "file.csv", "Name".toByteArray()).statusCode())
        assertEquals(403, preview(login("fpa"), UUID.randomUUID(), "file.csv", "Name".toByteArray()).statusCode())
        assertEquals(403, preview(token, UUID.randomUUID(), "file.csv", "Name".toByteArray(), "bank").statusCode())
        assertEquals(413, preview(token, UUID.randomUUID(), "large.csv", ByteArray(100 * 1024 * 1024 + 1)).statusCode())
    }

    @Test
    fun `recognized receivable previews override payable selection but custom previews retain it`() {
        val token = login("ar")
        val member = owner.queryForObject("SELECT id FROM finance.membership WHERE email='ar@vantara.com.br'", UUID::class.java)!!
        owner.update("INSERT INTO finance.member_role VALUES (?,?,'ap')", tenant, member)
        try {
            for (filename in listOf("01_contas_a_receber_protheus_jul2026.csv", "02_titulos_unidade_norte_omie_jul2026.csv")) {
                val bytes =
                    Files.readAllBytes(
                        java.nio.file.Path
                            .of("../../data_pack/$filename"),
                    )
                val detected = body(preview(token, UUID.randomUUID(), filename, bytes, "payable"))
                assertEquals("receivable", detected["dataset_kind"].asText())
                assertFalse(detected["targetFields"].toList().any { it.asText() == "booking_date" })
            }
            assertEquals(
                "payable",
                body(
                    preview(token, UUID.randomUUID(), "custom.csv", "Name,Total\nAcme,10".toByteArray(), "payable"),
                )["dataset_kind"].asText(),
            )
        } finally {
            owner.update("DELETE FROM finance.member_role WHERE member_id=? AND role='ap'", member)
        }
        val omie = "customer_name,tax_id,invoice_ref,due_date,amount,paid_flag\nAcme,,I1,2026-07-20,10,n"
        assertEquals(403, preview(login("ap"), UUID.randomUUID(), "omie.csv", omie.toByteArray(), "payable").statusCode())
    }

    private fun preview(
        token: String?,
        id: UUID,
        filename: String,
        bytes: ByteArray,
        kind: String = "receivable",
    ): HttpResponse<String> {
        val builder =
            HttpRequest
                .newBuilder(URI("http://localhost:$port/api/imports/preview?filename=$filename&kind=$kind"))
                .header("Idempotency-Key", id.toString())
        token?.let { builder.header("Authorization", "Bearer $it") }
        return http.send(builder.POST(HttpRequest.BodyPublishers.ofByteArray(bytes)).build(), HttpResponse.BodyHandlers.ofString())
    }

    @Test
    fun `pagination rejects both limits outside the supported range`() {
        val token = login("ar")
        val id = body(upload(token, "pagination.csv", "Name,Due,Total\nA,2026-07-20,1\n"), 201)["id"].asText()
        for (path in listOf("/imports?limit=0", "/imports/$id/rows?limit=0", "/imports/$id/results?limit=501")) {
            assertEquals(400, request("GET", path, token).statusCode(), path)
        }
        assertEquals(1, body(request("GET", "/imports/$id/rows?limit=1", token)).size())
    }

    @Test
    fun `Protheus explicit single unit mapping does not create source named units`() {
        val token = login("ar")
        val name = "Ignored-${UUID.randomUUID()}"
        val csv =
            "cliente;cnpj;unidade;documento;nosso_numero;tipo;emissao;vencimento;valor;status\n" +
                "Acme;;$name;F1;0001;Produto;01/07/2026;20/07/2026;1,00;Aberto\n"
        val id = body(upload(token, "single-unit.csv", csv), 201)["id"].asText()
        val mapping = """{"unitId":"$unit","columns":{"party_name":"cliente","due_on":"vencimento","amount":"valor"}}"""
        body(request("POST", "/imports/$id/confirm", token, mapping))
        assertEquals(0, body(request("POST", "/imports/$id/process", token))["rejected"].asInt())
        assertEquals(unit.toString(), body(request("GET", "/imports/$id/results", token))[0]["unit_id"].asText())
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM finance.business_unit WHERE name=?", Int::class.java, name))
    }

    @Test
    fun `idempotency key cannot switch datasets even when caller has both permissions`() {
        val token = login("ar")
        val member = owner.queryForObject("SELECT id FROM finance.membership WHERE email='ar@vantara.com.br'", UUID::class.java)!!
        owner.update("INSERT INTO finance.member_role VALUES (?,?,'ap')", tenant, member)
        try {
            val id = body(upload(token, "same.csv", "Name\nA\n"), 201)["id"].asText()
            val response =
                http.send(
                    HttpRequest
                        .newBuilder(URI("http://localhost:$port/api/imports?filename=same.csv&kind=payable"))
                        .header("Authorization", "Bearer $token")
                        .header("Idempotency-Key", id)
                        .POST(HttpRequest.BodyPublishers.ofString("Name\nB\n"))
                        .build(),
                    HttpResponse.BodyHandlers.ofString(),
                )
            assertEquals(409, response.statusCode())
            assertEquals("receivable", body(request("GET", "/imports/$id", token))["dataset_kind"].asText())
            assertEquals("Name\nA\n", request("GET", "/imports/$id/file", token).body())
        } finally {
            owner.update("DELETE FROM finance.member_role WHERE member_id=? AND role='ap'", member)
        }
    }

    @Test
    fun `oversized upload fails before storage and leaves a discoverable failed job`() {
        val token = login("ar")
        val id = UUID.randomUUID()
        val path = Files.createTempFile("oversized-import-", ".csv")
        try {
            java.io.RandomAccessFile(path.toFile(), "rw").use { it.setLength(100L * 1024 * 1024 + 1) }
            val response =
                http.send(
                    HttpRequest
                        .newBuilder(URI("http://localhost:$port/api/imports?filename=oversized.csv&kind=receivable"))
                        .header("Authorization", "Bearer $token")
                        .header("Idempotency-Key", id.toString())
                        .POST(HttpRequest.BodyPublishers.ofFile(path))
                        .build(),
                    HttpResponse.BodyHandlers.ofString(),
                )
            assertEquals(413, response.statusCode())
            val job = body(request("GET", "/imports/$id", token))
            assertEquals("failed", job["state"].asText())
            assertTrue(job["object_version"].isNull)
            assertEquals(0, job["total"].asInt())
            assertEquals(409, request("GET", "/imports/$id/file", token).statusCode())
        } finally {
            Files.delete(path)
        }
    }

    @Test
    fun `malformed worksheet XML and oversized parts retain evidence without staging rows`() {
        val token = login("ar")
        val original = java.io.ByteArrayOutputStream()
        org.apache.poi.xssf.usermodel.XSSFWorkbook().use { workbook ->
            workbook
                .createSheet()
                .createRow(0)
                .createCell(0)
                .setCellValue("Name")
            workbook.write(original)
        }
        val malformed = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(malformed).use { output ->
            java.util.zip.ZipInputStream(original.toByteArray().inputStream()).use { input ->
                while (true) {
                    val entry = input.nextEntry ?: break
                    output.putNextEntry(java.util.zip.ZipEntry(entry.name))
                    if (entry.name ==
                        "xl/worksheets/sheet1.xml"
                    ) {
                        output.write("<worksheet><broken>".toByteArray())
                    } else {
                        input.copyTo(output)
                    }
                    output.closeEntry()
                }
            }
        }
        assertEquals(400, uploadBytes(token, "malformed-xml.xlsx", malformed.toByteArray()).statusCode())
        val missingManifest = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(missingManifest).use { output ->
            output.putNextEntry(java.util.zip.ZipEntry("report.txt"))
            output.write("Not an OOXML workbook".toByteArray())
            output.closeEntry()
        }
        assertEquals(400, uploadBytes(token, "missing-manifest.xlsx", missingManifest.toByteArray()).statusCode())
        val oversized = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(oversized).use { output ->
            output.putNextEntry(java.util.zip.ZipEntry("xl/worksheets/sheet1.xml"))
            val block = ByteArray(65536)
            repeat(4096) { output.write(block) }
            output.write(0)
            output.closeEntry()
        }
        assertEquals(400, uploadBytes(token, "oversized-part.xlsx", oversized.toByteArray()).statusCode())
        val id = body(request("GET", "/imports", token))[0]["id"].asText()
        assertEquals("failed", body(request("GET", "/imports/$id", token))["state"].asText())
        assertEquals(0, body(request("GET", "/imports/$id/rows", token)).size())
        assertEquals(200, request("GET", "/imports/$id/file", token).statusCode())
    }

    @Test
    fun `explicit unit mappings preserve known destinations and reject unmapped rows`() {
        val token = login("ar")
        val id =
            body(
                upload(
                    token,
                    "units.csv",
                    "Name,Due,Total,Unit\nMapped,2026-07-20,1,known\nUnmapped,2026-07-20,1,missing\nBlank,2026-07-20,1,\n",
                ),
                201,
            )["id"].asText()
        body(
            request(
                "POST",
                "/imports/$id/confirm",
                token,
                """{"units":{"known":"$unit"},"columns":{"party_name":"Name","due_on":"Due","amount":"Total","unit":"Unit"}}""",
            ),
        )
        assertEquals(2, body(request("POST", "/imports/$id/process", token))["rejected"].asInt())
        assertEquals(
            400,
            request(
                "PATCH",
                "/imports/$id/rows/3",
                token,
                json.writeValueAsString(listOf("x".repeat(16385), "2026-07-20", "1", "known")),
            ).statusCode(),
        )
        val header = "cliente;cnpj;unidade;documento;nosso_numero;tipo;emissao;vencimento;valor;status\n"
        val protheus =
            body(
                upload(token, "mapped.csv", header + "Acme;;Unit;F1;0001;Produto;01/07/2026;20/07/2026;1,00;Aberto\n"),
                201,
            )["id"].asText()
        body(request("POST", "/imports/$protheus/confirm", token, "{}"))
        val second =
            body(
                upload(token, "mapped2.csv", header + "Acme;;Alias;F1;0001;Produto;01/07/2026;20/07/2026;1,00;Aberto\n"),
                201,
            )["id"].asText()
        body(request("POST", "/imports/$second/confirm", token, """{"units":{"Alias":"$unit"}}"""))
        val many =
            body(
                upload(
                    token,
                    "many.csv",
                    header + (1..1001).joinToString("\n") { "Acme;;U$it;F1;0001;Produto;01/07/2026;20/07/2026;1,00;Aberto" },
                ),
                201,
            )["id"].asText()
        assertEquals(400, request("POST", "/imports/$many/confirm", token, "{}").statusCode())
    }

    @Test
    fun `manual bank mapping validates direction account currency and missing fields`() {
        val token = login("reconciliation")
        val id =
            body(
                upload(
                    token,
                    "custom-bank.csv",
                    "Date,Text,Amount,Direction\n2026-07-20,Incoming,1,credit\n2026-07-20,Outgoing,2,debit\n2026-07-20,Bad,3,other\n2026-07-20,,4,C\n",
                    "bank",
                ),
                201,
            )["id"].asText()
        val columns = """"columns":{"booking_date":"Date","description":"Text","amount":"Amount","direction":"Direction"}"""
        assertEquals(
            403,
            request(
                "POST",
                "/imports/$id/confirm",
                token,
                """{"unitId":"$unit","accountId":"${UUID.randomUUID()}",$columns}""",
            ).statusCode(),
        )
        owner.update("UPDATE finance.business_unit SET active=false WHERE id=?", unit)
        try {
            assertEquals(
                400,
                request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit","accountId":"$account",$columns}""").statusCode(),
            )
        } finally {
            owner.update("UPDATE finance.business_unit SET active=true WHERE id=?", unit)
        }
        owner.update("UPDATE finance.bank_account SET active=false WHERE id=?", account)
        try {
            assertEquals(
                403,
                request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit","accountId":"$account",$columns}""").statusCode(),
            )
        } finally {
            owner.update("UPDATE finance.bank_account SET active=true WHERE id=?", account)
        }
        assertEquals("mapping", body(request("GET", "/imports/$id", token))["state"].asText())
        body(request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit","accountId":"$account",$columns}"""))
        assertEquals(2, body(request("POST", "/imports/$id/process", token))["rejected"].asInt())
        assertEquals(2, body(request("GET", "/imports/$id/results", token)).size())
    }

    @Test
    fun `idempotency conflicts empty datasets and mismatched profiles are explicit`() {
        val token = login("ar")
        assertEquals(400, upload(token, "", "Name").statusCode())
        assertEquals(400, upload(token, "x".repeat(201) + ".csv", "Name").statusCode())
        val id = body(upload(token, "headers.csv", "Name,Due,Total\n"), 201)["id"].asText()
        val columns = """"columns":{"party_name":"Name","due_on":"Due","amount":"Total"}"""
        assertEquals(
            400,
            request(
                "POST",
                "/imports/$id/confirm",
                token,
                """{"unitId":"$unit","columns":{"party_name":"Name","due_on":"Due","amount":"Total","unknown":"Name"}}""",
            ).statusCode(),
        )
        for (query in listOf("filename=other.csv&kind=receivable", "filename=headers.csv&kind=payable")) {
            val response =
                http.send(
                    HttpRequest
                        .newBuilder(URI("http://localhost:$port/api/imports?$query"))
                        .header(
                            "Authorization",
                            "Bearer $token",
                        ).header("Idempotency-Key", id)
                        .POST(HttpRequest.BodyPublishers.ofString("Name"))
                        .build(),
                    HttpResponse.BodyHandlers.ofString(),
                )
            // AR cannot use payable scope, even for an existing idempotency key.
            assertEquals(if (query.contains("payable")) 403 else 409, response.statusCode())
        }
        owner.update("UPDATE finance.ingestion SET state='failed' WHERE id=?", UUID.fromString(id))
        assertEquals(409, request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit",$columns}""").statusCode())
        body(request("POST", "/imports/$id/prepare", token))
        body(request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit",$columns}"""))
        assertEquals("completed", body(request("POST", "/imports/$id/process", token))["state"].asText())
        val bank = body(upload(token, "mismatch.csv", "data;historico;documento;valor;tipo\n20/07/2026;X;;1,00;C\n"), 201)["id"].asText()
        assertEquals(400, request("POST", "/imports/$bank/confirm", token, """{"unitId":"$unit"}""").statusCode())
        val payable =
            body(
                upload(
                    login("ap"),
                    "mismatch.csv",
                    "customer_name,tax_id,invoice_ref,due_date,amount,paid_flag\nA,,F1,2026-07-20,1,N\n",
                    "payable",
                ),
                201,
            )["id"].asText()
        assertEquals(400, request("POST", "/imports/$payable/confirm", login("ap"), """{"unitId":"$unit"}""").statusCode())
    }

    @Test
    fun `unversioned storage fails closed and incomplete originals cannot be downloaded or prepared`() {
        val token = login("ar")
        s3.putBucketVersioning { it.bucket("vantara-ingestion-local").versioningConfiguration { c -> c.status("Suspended") } }
        try {
            assertEquals(503, upload(token, "unversioned.csv", "Name\nValue\n").statusCode())
            val id = body(request("GET", "/imports", token))[0]["id"].asText()
            assertEquals(409, request("GET", "/imports/$id/file", token).statusCode())
            assertEquals(409, request("POST", "/imports/$id/prepare", token).statusCode())
        } finally {
            s3.putBucketVersioning { it.bucket("vantara-ingestion-local").versioningConfiguration { c -> c.status("Enabled") } }
        }
    }

    @Test
    fun `sparse and 1904 XLSX retains dates precision and zero padded identifiers`() {
        val token = login("ar")
        val output = java.io.ByteArrayOutputStream()
        org.apache.poi.xssf.usermodel.XSSFWorkbook().use { workbook ->
            workbook.ctWorkbook.workbookPr.date1904 = true
            val sheet = workbook.createSheet()
            val headers = listOf("Name", "Due", "Total", "Ref", "Optional")
            headers.forEachIndexed { i, value ->
                sheet.getRow(0)?.createCell(i)?.setCellValue(value)
                    ?: sheet.createRow(0).createCell(i).setCellValue(value)
            }
            val row = sheet.createRow(1)
            row.createCell(0).setCellValue("Customer")
            row.createCell(1).apply {
                setCellValue(
                    org.apache.poi.ss.usermodel.DateUtil
                        .getExcelDate(java.time.LocalDate.of(2026, 7, 20), true),
                )
                cellStyle = workbook.createCellStyle().apply { dataFormat = workbook.createDataFormat().getFormat("dd/mm/yyyy") }
            }
            row.createCell(2).apply {
                setCellValue(12.34)
                cellStyle = workbook.createCellStyle().apply { dataFormat = workbook.createDataFormat().getFormat("0000000") }
            }
            row.createCell(3).apply {
                setCellValue(123.0)
                cellStyle = workbook.createCellStyle().apply { dataFormat = workbook.createDataFormat().getFormat("0000000") }
            }
            workbook.write(output)
        }
        val response = uploadBytes(token, "date.xlsx", output.toByteArray())
        val id = body(response, 201)["id"].asText()
        body(
            request(
                "POST",
                "/imports/$id/confirm",
                token,
                """{"unitId":"$unit","columns":{"party_name":"Name","due_on":"Due","amount":"Total","external_id":"Ref"}}""",
            ),
        )
        body(request("POST", "/imports/$id/process", token))
        val result = body(request("GET", "/imports/$id/results", token))[0]
        assertEquals("2026-07-20", result["due_on"].asText())
        assertEquals("0000123", result["external_id"].asText())
        assertEquals(1234, result["original_amount_minor"].asInt())
    }

    @Test
    fun `unsupported workbook layouts and malformed archives never reach financial processing`() {
        val token = login("ar")
        for (variant in listOf("empty", "multiple", "wide", "long-cell")) {
            val output = java.io.ByteArrayOutputStream()
            org.apache.poi.xssf.usermodel.XSSFWorkbook().use { workbook ->
                if (variant != "empty") {
                    val sheet = workbook.createSheet()
                    val row = sheet.createRow(0)
                    row.createCell(0).setCellValue("Name")
                    if (variant == "multiple") workbook.createSheet()
                    if (variant == "wide") row.createCell(100).setCellValue("Too wide")
                    if (variant == "long-cell") sheet.createRow(1).createCell(0).setCellValue("x".repeat(16385))
                }
                workbook.write(output)
            }
            assertEquals(400, uploadBytes(token, "$variant.xlsx", output.toByteArray()).statusCode(), variant)
        }
        assertEquals(400, uploadBytes(token, "broken.xlsx", "not a zip".toByteArray()).statusCode())
        val bomb = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(bomb).use { zip ->
            zip.putNextEntry(java.util.zip.ZipEntry("xl/sharedStrings.xml"))
            val block = ByteArray(65536) { 65 }
            repeat(257) { zip.write(block) }
            zip.closeEntry()
        }
        assertEquals(400, uploadBytes(token, "oversized.xlsx", bomb.toByteArray()).statusCode())
        assertEquals(400, upload(token, "wide.csv", (0..100).joinToString(",") { "H$it" }).statusCode())
    }

    private fun uploadBytes(
        token: String,
        filename: String,
        bytes: ByteArray,
    ): HttpResponse<String> =
        http.send(
            HttpRequest
                .newBuilder(URI("http://localhost:$port/api/imports?filename=$filename&kind=receivable"))
                .header("Authorization", "Bearer $token")
                .POST(HttpRequest.BodyPublishers.ofByteArray(bytes))
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )

    @Test
    fun `manual import validates financial values and retains independent row errors`() {
        val token = login("ap")
        val csv =
            "Name,Due,Value,Tax,Status,Issued\n" +
                "Valid,2026-07-20,5.01,12345678901,disputed,2026-07-01\n" +
                "Cancelled,2026-07-20,1.00,,cancelled,\n" +
                "Missing,,1.00,,open,\n" +
                "Zero,2026-07-20,0,,open,\n" +
                "Negative,2026-07-20,-1,,open,\n" +
                "Precision,2026-07-20,1.001,,open,\n" +
                "Overflow,2026-07-20,999999999999999999999999,,open,\n" +
                "Tax,2026-07-20,1,abc,open,\n" +
                "Status,2026-07-20,1,,mystery,\n" +
                "Short,2026-07-20\n"
        val id = body(upload(token, "manual.csv", csv, "payable"), 201)["id"].asText()
        body(
            request(
                "POST",
                "/imports/$id/confirm",
                token,
                """{"unitId":"$unit","currency":"USD","dateFormat":"uuuu-MM-dd","decimal":".","columns":{"party_name":"Name","due_on":"Due","amount":"Value","party_tax_id":"Tax","status":"Status","issued_on":"Issued"}}""",
            ),
        )
        val result = body(request("POST", "/imports/$id/process", token))
        assertEquals(8, result["rejected"].asInt())
        assertEquals(2, body(request("GET", "/imports/$id/results", token)).size())
        assertEquals(501L, body(request("GET", "/imports/$id/results", token))[0]["original_amount_minor"].asLong())
    }

    @Test
    fun `assistant inbox import persists one open payable and retains unstructured source`() {
        val token = login("ap")
        val source =
            java.nio.file.Files
                .readString(
                    java.nio.file.Path
                        .of("../../data_pack/04_caixa_de_entrada_contas_a_pagar.txt"),
                )
        val headers = listOf("party_name", "document_ref", "due_on", "amount", "source_type") + (1..8).map { "source_$it" }
        val cells = listOf("Sao Jorge Embalagens", "88231", "2026-07-20", "18900.00", "agent_unstructured", source) + List(7) { "" }
        val csv = listOf(headers, cells).joinToString("\r\n") { row -> row.joinToString(",") { "\"${it.replace("\"", "\"\"")}\"" } }
        val id = body(upload(token, "assistant-import.csv", csv, "payable"), 201)["id"].asText()
        assertEquals(source, body(request("GET", "/imports/$id/rows", token))[0]["cells"][5].asText())
        body(
            request(
                "POST",
                "/imports/$id/confirm",
                token,
                """{"unitId":"$unit","currency":"BRL","dateFormat":"uuuu-MM-dd","decimal":".","columns":{"party_name":"party_name","document_ref":"document_ref","due_on":"due_on","amount":"amount"}}""",
            ),
        )
        repeat(2) {
            val processed = body(request("POST", "/imports/$id/process", token))
            assertEquals("completed", processed["state"].asText())
            assertEquals(1, processed["processed"].asInt())
            assertEquals(0, processed["rejected"].asInt())
        }
        val titles = body(request("GET", "/imports/$id/results", token))
        assertEquals(1, titles.size())
        val title = titles[0]
        assertEquals("Sao Jorge Embalagens", title["party_name"].asText())
        assertEquals("88231", title["document_ref"].asText())
        assertEquals("2026-07-20", title["due_on"].asText())
        assertEquals("BRL", title["currency"].asText())
        assertEquals(1890000L, title["original_amount_minor"].asLong())
        assertEquals(1890000L, title["current_amount_minor"].asLong())
        assertEquals("open", title["status"].asText())
        assertEquals("payable", title["direction"].asText())
        assertTrue(title["issued_on"].isNull)
        assertEquals(csv, request("GET", "/imports/$id/file", token).body())
        assertEquals(404, request("GET", "/imports/$id/results", login("ar")).statusCode())
    }

    @Test
    fun `upload and mapping reject malformed requests before financial writes`() {
        val token = login("ar")
        for ((name, csv) in listOf(
            "bad.txt" to "text",
            "empty.csv" to "",
            "bad.csv" to "Name,Name\nx,y\n",
            "blank.csv" to ",Due\nx,y\n",
            "broken.csv" to "Name,Due,Total\n\"unclosed",
            "large-cell.csv" to "Name\n${"x".repeat(16385)}",
        )) {
            assertEquals(400, upload(token, name, csv).statusCode(), name)
        }
        assertEquals(400, upload(token, "x.csv", "Name\nx", "invalid").statusCode())
        val id = body(upload(token, "valid.csv", "Name,Due,Total\nAcme,2026-07-20,1.00\n"), 201)["id"].asText()
        for (suffix in listOf("/rows?after=-1", "/rows?limit=501", "/results?after=-1", "/results?limit=0")) {
            assertEquals(400, request("GET", "/imports/$id$suffix", token).statusCode())
        }
        assertEquals(400, request("GET", "/imports?offset=-1", token).statusCode())
        assertEquals(400, request("GET", "/imports?limit=101", token).statusCode())
        assertEquals(400, request("PATCH", "/imports/$id/rows/2", token, "[]").statusCode())
        assertEquals(409, request("PATCH", "/imports/$id/rows/2", token, """["A","2026-07-20","2"]""").statusCode())
        val columns = """"columns":{"party_name":"Name","due_on":"Due","amount":"Total"}"""
        for (payload in listOf(
            "{}",
            """{$columns}""",
            """{"unitId":"$unit",$columns,"decimal":";"}""",
            """{"unitId":"$unit",$columns,"dateFormat":"MM/dd/yyyy"}""",
            """{"unitId":"$unit",$columns,"currency":"JPY"}""",
            """{"unitId":"$unit","columns":{"party_name":"Unknown","due_on":"Due","amount":"Total"}}""",
        )) {
            assertEquals(400, request("POST", "/imports/$id/confirm", token, payload).statusCode(), payload)
        }
        assertEquals(403, request("POST", "/imports/$id/confirm", token, """{"unitId":"$otherUnit",$columns}""").statusCode())
        body(request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit",$columns}"""))
        assertEquals(409, request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit",$columns,"currency":"EUR"}""").statusCode())
        body(request("POST", "/imports/$id/prepare", token))
        for (method in listOf("GET", "POST")) {
            val path = if (method == "GET") "/imports/${UUID.randomUUID()}" else "/imports/${UUID.randomUUID()}/process"
            assertEquals(404, request(method, path, token).statusCode())
        }
    }

    @Test
    fun `XLSX bank dates and Brazilian formatted amounts import without losing cents`() {
        val token = login("reconciliation")
        val output = java.io.ByteArrayOutputStream()
        org.apache.poi.xssf.usermodel.XSSFWorkbook().use { workbook ->
            val sheet = workbook.createSheet("Statement")
            val header = sheet.createRow(0)
            listOf("data", "historico", "documento", "valor", "tipo").forEachIndexed {
                i,
                value,
                ->
                header.createCell(i).setCellValue(value)
            }
            val row = sheet.createRow(1)
            row.createCell(0).apply {
                setCellValue(java.time.LocalDate.of(2026, 7, 20))
                cellStyle = workbook.createCellStyle().apply { dataFormat = workbook.createDataFormat().getFormat("dd/mm/yyyy") }
            }
            row.createCell(1).setCellValue("Payment")
            row.createCell(2).setCellValue("0000123")
            row.createCell(3).apply {
                setCellValue(18450.01)
                cellStyle = workbook.createCellStyle().apply { dataFormat = workbook.createDataFormat().getFormat("#,##0") }
            }
            row.createCell(4).setCellValue("C")
            workbook.write(output)
        }
        val response =
            http.send(
                HttpRequest
                    .newBuilder(URI("http://localhost:$port/api/imports?filename=statement.xlsx&kind=bank"))
                    .header("Authorization", "Bearer $token")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(output.toByteArray()))
                    .build(),
                HttpResponse.BodyHandlers.ofString(),
            )
        val id = body(response, 201)["id"].asText()
        body(request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit","accountId":"$account"}"""))
        assertEquals(0, body(request("POST", "/imports/$id/process", token))["rejected"].asInt())
        assertEquals(1845001L, body(request("GET", "/imports/$id/results", token))[0]["amount_minor"].asLong())
    }

    @Test
    fun `upload retries recover original job and preparation resumes persisted evidence`() {
        val token = login("ar")
        val id = UUID.randomUUID()
        val csv = "Name,Due,Total\nCustomer,2026-07-20,2.00\n"

        fun send(): HttpResponse<String> =
            http.send(
                HttpRequest
                    .newBuilder(URI("http://localhost:$port/api/imports?filename=retry.csv&kind=receivable"))
                    .header("Authorization", "Bearer $token")
                    .header("Idempotency-Key", id.toString())
                    .POST(HttpRequest.BodyPublishers.ofString(csv))
                    .build(),
                HttpResponse.BodyHandlers.ofString(),
            )
        val first = body(send(), 201)
        assertEquals(id.toString(), first["id"].asText())
        assertEquals(first["object_version"], body(send(), 201)["object_version"])
        // Simulate a process stopping after persistence but before preparation completed.
        owner.update("UPDATE finance.ingestion SET state='uploading' WHERE id=?", id)
        assertEquals("mapping", body(request("POST", "/imports/$id/prepare", token))["state"].asText())
        assertEquals(1, body(request("GET", "/imports/$id/rows", token)).size())
        assertTrue(body(request("GET", "/imports", token)).any { it["id"].asText() == id.toString() })
    }

    @Test
    fun `rejected rows can be corrected without rewriting original evidence`() {
        val token = login("ar")
        val csv = "Name,Due,Total\nBroken,2026-02-30,5.00\n"
        val id = body(upload(token, "fix.csv", csv), 201)["id"].asText()
        body(
            request(
                "POST",
                "/imports/$id/confirm",
                token,
                """{"unitId":"$unit","columns":{"party_name":"Name","due_on":"Due","amount":"Total"}}""",
            ),
        )
        body(request("POST", "/imports/$id/process", token))
        body(request("PATCH", "/imports/$id/rows/2", token, """["Broken","2026-02-28","5.00"]"""))
        val done = body(request("POST", "/imports/$id/process", token))
        assertEquals(0, done["rejected"].asInt())
        assertEquals(1, done["processed"].asInt())
        assertEquals(csv, request("GET", "/imports/$id/file", token).body())
        assertEquals("2026-02-30", body(request("GET", "/imports/$id/rows", token))[0]["cells"][1].asText())
        assertEquals(409, request("PATCH", "/imports/$id/rows/2", token, """["Changed","2026-02-28","6.00"]""").statusCode())
    }

    @Test
    fun `Itau imports credit and debit evidence and revocation immediately blocks original and rows`() {
        val token = login("reconciliation")
        val csv =
            Files.readString(
                java.nio.file.Path
                    .of("../../data_pack/03_extrato_bancario_jul2026.csv"),
            )
        val memberId =
            owner.queryForObject(
                "SELECT id FROM finance.membership WHERE email='reconciliation@vantara.com.br'",
                UUID::class.java,
            )!!
        owner.update("INSERT INTO finance.member_role VALUES (?,?,'ar')", tenant, memberId)
        val detected =
            try {
                body(preview(token, UUID.randomUUID(), "bank.csv", csv.toByteArray(), "receivable"))
            } finally {
                owner.update("DELETE FROM finance.member_role WHERE member_id=? AND role='ar'", memberId)
            }
        assertEquals("bank", detected["dataset_kind"].asText())
        assertTrue(detected["targetFields"].toList().any { it.asText() == "booking_date" })
        assertFalse(detected["targetFields"].toList().any { it.asText() == "due_on" })
        assertEquals(403, preview(login("ar"), UUID.randomUUID(), "bank.csv", csv.toByteArray(), "receivable").statusCode())
        val uploaded = body(upload(token, "bank.csv", csv, detected["dataset_kind"].asText()), 201)
        val id = uploaded["id"].asText()
        assertEquals("itau", uploaded["platform"].asText())
        assertEquals(403, request("POST", "/imports/$id/confirm", token, """{"unitId":"$otherUnit","accountId":"$account"}""").statusCode())
        assertEquals(400, request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit"}""").statusCode())
        body(request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit","accountId":"$account"}"""))
        val done = body(request("POST", "/imports/$id/process", token))
        assertEquals(0, done["rejected"].asInt())
        val entries = body(request("GET", "/imports/$id/results", token))
        assertEquals(18, entries.size())
        assertEquals(
            18,
            owner.queryForObject(
                "SELECT count(*) FROM finance.bank_entry b JOIN finance.ingestion_row r ON r.result_id=b.id WHERE r.ingestion_id=?",
                Int::class.java,
                UUID.fromString(id),
            ),
        )
        assertEquals(
            0,
            owner.queryForObject(
                "SELECT count(*) FROM finance.title t JOIN finance.ingestion_row r ON r.result_id=t.id WHERE r.ingestion_id=?",
                Int::class.java,
                UUID.fromString(id),
            ),
        )
        assertEquals("debit", entries[5]["direction"].asText())
        assertEquals(124000L, entries[5]["amount_minor"].asLong())
        assertEquals("000012345678", entries[0]["external_ref"].asText())
        assertEquals(403, upload(login("ar"), "bank.csv", csv, "bank").statusCode())
        val member =
            owner.queryForObject(
                "SELECT id FROM finance.membership WHERE email='reconciliation@vantara.com.br'",
                UUID::class.java,
            )!!
        owner.update("DELETE FROM finance.member_bank_account WHERE member_id=? AND account_id=?", member, account)
        try {
            for (suffix in listOf(
                "",
                "/file",
                "/rows",
                "/results",
            )) {
                assertEquals(404, request("GET", "/imports/$id$suffix", token).statusCode())
            }
        } finally {
            owner.update("INSERT INTO finance.member_bank_account VALUES (?,?,?,?)", tenant, member, unit, account)
        }
    }

    @Test
    fun `custom CSV uses bounded resumable chunks and keeps manual mapping explicit`() {
        val token = login("ar")
        val csv =
            buildString {
                append("Name,Due,Total\n")
                repeat(10001) { append("\"Customer, $it\",2026-07-20,1.23\n") }
            }
        val id = body(upload(token, "manual.csv", csv), 201)["id"].asText()
        assertEquals(409, request("POST", "/imports/$id/process", token).statusCode())
        val mapping = """{"unitId":"$unit","columns":{"party_name":"Name","due_on":"Due","amount":"Total"}}"""
        body(request("POST", "/imports/$id/confirm", token, mapping))
        val first = body(request("POST", "/imports/$id/process", token))
        assertEquals(500, first["processed"].asInt())
        assertEquals("processing", first["state"].asText())
        repeat(20) { body(request("POST", "/imports/$id/process", token)) }
        val done = body(request("GET", "/imports/$id", token))
        assertEquals(10001, done["processed"].asInt())
        assertEquals(0, done["rejected"].asInt())
        assertEquals("completed", done["state"].asText())
        assertEquals(1, body(request("GET", "/imports/$id/results?after=10001", token)).size())
        assertEquals(123, body(request("GET", "/imports/$id/results?limit=1", token))[0]["original_amount_minor"].asInt())
    }

    @Test
    fun `XLSX custom reports preview mapping and import quoted values`() {
        val path = Files.createTempFile("report", ".xlsx")
        java.util.zip.ZipOutputStream(Files.newOutputStream(path)).use { zip ->
            fun entry(
                name: String,
                text: String,
            ) {
                zip.putNextEntry(java.util.zip.ZipEntry(name))
                zip.write(text.toByteArray())
                zip.closeEntry()
            }
            entry(
                "[Content_Types].xml",
                """<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>""",
            )
            entry(
                "_rels/.rels",
                """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""",
            )
            entry(
                "xl/workbook.xml",
                """<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>""",
            )
            entry(
                "xl/_rels/workbook.xml.rels",
                """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>""",
            )
            entry(
                "xl/worksheets/sheet1.xml",
                """<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Due</t></is></c><c r="C1" t="inlineStr"><is><t>Total</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Manual customer</t></is></c><c r="B2" t="inlineStr"><is><t>2026-07-20</t></is></c><c r="C2"><v>12.34</v></c></row></sheetData></worksheet>""",
            )
        }
        try {
            val token = login("ar")
            val request =
                HttpRequest
                    .newBuilder(URI("http://localhost:$port/api/imports?filename=manual.xlsx&kind=receivable"))
                    .header("Authorization", "Bearer $token")
                    .header("Content-Type", "application/octet-stream")
                    .POST(HttpRequest.BodyPublishers.ofFile(path))
                    .build()
            val imported = body(http.send(request, HttpResponse.BodyHandlers.ofString()), 201)
            val id = imported["id"].asText()
            assertEquals("custom", imported["platform"].asText())
            assertEquals(400, this.request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit"}""").statusCode())
            body(
                this.request(
                    "POST",
                    "/imports/$id/confirm",
                    token,
                    """{"unitId":"$unit","columns":{"party_name":"Name","due_on":"Due","amount":"Total"}}""",
                ),
            )
            body(this.request("POST", "/imports/$id/process", token))
            assertEquals(1234L, body(this.request("GET", "/imports/$id/results", token))[0]["original_amount_minor"].asLong())
        } finally {
            Files.delete(path)
        }
    }

    @Test
    fun `Protheus routes units creates missing units and keeps source identifiers`() {
        val token = login("ar")
        val csv =
            Files.readString(
                java.nio.file.Path
                    .of("../../data_pack/01_contas_a_receber_protheus_jul2026.csv"),
            )
        val id = body(upload(token, "ar.csv", csv), 201)["id"].asText()
        assertEquals("protheus", body(request("GET", "/imports/$id", token))["platform"].asText())
        body(request("POST", "/imports/$id/confirm", token, "{}"))
        assertEquals(0, body(request("POST", "/imports/$id/process", token))["rejected"].asInt())
        val results = body(request("GET", "/imports/$id/results", token))
        assertEquals(12, results.size())
        assertEquals(1845000L, results[0]["original_amount_minor"].asLong())
        assertEquals("000012345678", results[0]["external_id"].asText())
        assertEquals(
            5,
            results
                .toList()
                .map { it["unit_id"].asText() }
                .distinct()
                .size,
        )
        body(request("POST", "/imports/$id/confirm", token, "{}"))
    }

    @Test
    fun `Omie confirmation imports valid titles and preserves row errors with retry safety`() {
        val token = login("ar")
        val csv =
            "customer_name,tax_id,invoice_ref,due_date,amount,paid_flag\n" +
                "ACME,00123456000100,F1,2026-07-20,31250.00,N\nBad,,F2,2026-02-30,10.00,N\nPaid,,F3,2026-07-20,10.00,Y\n"
        val id = body(upload(token, "any.csv", csv), 201)["id"].asText()
        val confirm = """{"unitId":"$unit"}"""
        assertEquals("processing", body(request("POST", "/imports/$id/confirm", token, confirm))["state"].asText())
        val result = body(request("POST", "/imports/$id/process", token))
        assertEquals("completed", result["state"].asText())
        assertEquals(3, result["processed"].asInt())
        assertEquals(2, result["rejected"].asInt())
        val rows = body(request("GET", "/imports/$id/rows", token))
        assertEquals("accepted", rows[0]["state"].asText())
        assertEquals("rejected", rows[1]["state"].asText())
        assertTrue(rows[2]["error"].asText().contains("settlement"))
        val titles = body(request("GET", "/imports/$id/results", token))
        assertEquals(1, titles.size())
        assertEquals(3125000L, titles[0]["original_amount_minor"].asLong())
        assertEquals("00123456000100", titles[0]["party_tax_id"].asText())
        body(request("POST", "/imports/$id/process", token))
        body(request("POST", "/imports/$id/confirm", token, confirm))
        assertEquals(1, body(request("GET", "/imports/$id/results", token)).size())
    }

    @Test
    fun `structured upload detects Omie persists original in Floci and isolates file access`() {
        val token = login("ar")
        val csv =
            Files.readString(
                java.nio.file.Path
                    .of("../../data_pack/02_titulos_unidade_norte_omie_jul2026.csv"),
            )
        val uploaded = body(upload(token, "report.csv", csv), 201)
        val id = uploaded["id"].asText()
        assertEquals("omie", uploaded["platform"].asText())
        assertEquals("mapping", uploaded["state"].asText())
        assertEquals(5, uploaded["total"].asInt())
        assertEquals(csv, request("GET", "/imports/$id/file", token).body())
        assertEquals(404, request("GET", "/imports/$id", login("ap")).statusCode())
        assertEquals(404, request("GET", "/imports/$id/file", login("admin")).statusCode())
        assertEquals(401, upload(null, "report.csv", csv).statusCode())
        assertEquals(403, upload(login("fpa"), "report.csv", csv).statusCode())
    }

    private fun upload(
        token: String?,
        filename: String,
        content: String,
        kind: String = "receivable",
    ): HttpResponse<String> {
        val builder =
            HttpRequest
                .newBuilder(URI("http://localhost:$port/api/imports?filename=$filename&kind=$kind"))
                .header("Content-Type", "application/octet-stream")
        token?.let { builder.header("Authorization", "Bearer $it") }
        return http.send(builder.POST(HttpRequest.BodyPublishers.ofString(content)).build(), HttpResponse.BodyHandlers.ofString())
    }

    @Test
    fun `business units can be registered without granting access to existing restricted units`() {
        val token = login()
        val name = "New-${UUID.randomUUID()}"
        val created = body(request("POST", "/business-units", token, """{"name":"$name"}"""), 201)
        assertEquals(name, created["name"].asText())
        assertTrue(body(request("GET", "/business-units", token)).any { it["id"] == created["id"] })
        assertEquals(409, request("POST", "/business-units", token, """{"name":"Other"}""").statusCode())
        assertEquals(403, request("POST", "/business-units", login("fpa"), """{"name":"Forbidden"}""").statusCode())
        assertEquals(400, request("POST", "/business-units", token, """{"name":" "}""").statusCode())
    }

    @Test
    fun `destinations are managed within scope and disabled without deleting history`() {
        val token = login()
        val name = "Managed-${UUID.randomUUID()}"
        val created = body(request("POST", "/business-units", token, """{"name":"$name"}"""), 201)
        val unitId = created["id"].asText()
        val accountBody = """{"unitIds":["$unitId"],"bankCode":"341","accountRef":"${UUID.randomUUID()}","currency":"BRL"}"""
        val account = body(request("POST", "/bank-accounts", token, accountBody), 201)
        val accountId = account["id"].asText()
        assertTrue(account["active"].asBoolean())
        assertTrue(body(request("GET", "/bank-accounts", token)).any { it["id"] == account["id"] })
        assertFalse(body(request("GET", "/bank-accounts", login("fpa"))).any { it["id"] == account["id"] })
        assertEquals(409, request("POST", "/bank-accounts", token, accountBody).statusCode())
        assertEquals(403, request("POST", "/bank-accounts", login("fpa"), accountBody).statusCode())
        assertEquals(403, request("POST", "/bank-accounts", token, accountBody.replace(unitId, UUID.randomUUID().toString())).statusCode())
        assertEquals(400, request("POST", "/bank-accounts", token, accountBody.replace("BRL", "XXX")).statusCode())

        val patch = """{"bankCode":"001","accountRef":"updated-$accountId","active":false}"""
        assertEquals(403, request("PATCH", "/bank-accounts/$accountId", login("fpa"), patch).statusCode())
        assertEquals(404, request("PATCH", "/bank-accounts/${UUID.randomUUID()}", token, patch).statusCode())
        val updated = body(request("PATCH", "/bank-accounts/$accountId", token, patch))
        assertFalse(updated["active"].asBoolean())
        assertEquals("001", updated["bank_code"].asText())
        val unitPatch = """{"name":"$name updated","active":false}"""
        assertEquals(403, request("PATCH", "/business-units/$unitId", login("fpa"), unitPatch).statusCode())
        assertEquals(404, request("PATCH", "/business-units/${UUID.randomUUID()}", token, unitPatch).statusCode())
        assertFalse(body(request("PATCH", "/business-units/$unitId", token, unitPatch))["active"].asBoolean())
        assertEquals(403, request("POST", "/bank-accounts", token, accountBody).statusCode())
        assertEquals(
            1,
            owner.queryForObject(
                "SELECT count(*) FROM finance.bank_account WHERE id=? AND NOT active",
                Int::class.java,
                UUID.fromString(accountId),
            ),
        )
        assertEquals(
            1,
            owner.queryForObject(
                "SELECT count(*) FROM finance.business_unit WHERE id=? AND NOT active",
                Int::class.java,
                UUID.fromString(unitId),
            ),
        )
        for (table in listOf("business_unit", "bank_account")) {
            assertThrows(org.springframework.dao.DataAccessException::class.java) {
                access.transaction(decoder.decode(token), tenant) { _, _ -> runtime.update("DELETE FROM finance.$table") }
            }
        }
    }

    @Test
    fun `shared accounts retain scoped visibility delegation and historical imports`() {
        val admin = login()
        val first = body(request("POST", "/business-units", admin, """{"name":"Shared-first-${UUID.randomUUID()}"}"""), 201)["id"].asText()
        val second =
            body(
                request("POST", "/business-units", admin, """{"name":"Shared-second-${UUID.randomUUID()}"}"""),
                201,
            )["id"].asText()
        val reference = UUID.randomUUID().toString()
        val created =
            body(
                request(
                    "POST",
                    "/bank-accounts",
                    admin,
                    """{"unitIds":["$first","$second"],"bankCode":"341","accountRef":"$reference","currency":"BRL"}""",
                ),
                201,
            )
        val accountId = created["id"].asText()
        assertEquals(setOf(first, second), created["unit_ids"].asSequence().map { it.asText() }.toSet())
        assertTrue(created["configurable"].asBoolean())
        assertEquals(
            400,
            request(
                "POST",
                "/bank-accounts",
                admin,
                """{"unitIds":[],"bankCode":"341","accountRef":"empty","currency":"BRL"}""",
            ).statusCode(),
        )
        val email = "${UUID.randomUUID()}@example.com"
        val member =
            body(
                request(
                    "POST",
                    "/users",
                    admin,
                    """{"email":"$email","password":"@Test123","roles":["admin","reconciliation"],"unitIds":["$first","$second"],"bankAccountIds":["$accountId"]}""",
                ),
                201,
            )
        assertEquals(1, member["bankAccountIds"].size())
        val memberId = member["id"].asText()
        body(request("PATCH", "/users/$memberId", admin, """{"unitIds":["$second"],"bankAccountIds":["$accountId"]}"""))
        val token =
            cognito
                .initiateAuth {
                    it.clientId(config.getProperty("cognito.client-id")).authFlow("USER_PASSWORD_AUTH").authParameters(
                        mapOf(
                            "USERNAME" to email,
                            "PASSWORD" to "@Test123",
                        ),
                    )
                }.authenticationResult()
                .accessToken()
        val visible = body(request("GET", "/bank-accounts", token)).single()
        assertEquals(accountId, visible["id"].asText())
        assertEquals(listOf(second), visible["unit_ids"].asSequence().map { it.asText() }.toList())
        assertFalse(visible["configurable"].asBoolean())
        val patch = """{"bankCode":"341","accountRef":"$reference","active":true,"unitIds":["$first"]}"""
        assertEquals(404, request("PATCH", "/bank-accounts/$accountId", token, patch).statusCode())
        assertEquals(403, request("PATCH", "/bank-accounts/$accountId", admin, patch.replace(first, otherUnit.toString())).statusCode())
        assertEquals(2, body(request("GET", "/bank-accounts", admin)).first { it["id"].asText() == accountId }["unit_ids"].size())
        val csv = "Date,Text,Amount,Direction,Ref\n2026-07-20,Shared account,2,credit,shared-ref\n"
        val columns =
            """"columns":{"booking_date":"Date","description":"Text","amount":"Amount","direction":"Direction","external_id":"Ref"}"""
        val uploadId = body(upload(token, "shared.csv", csv, "bank"), 201)["id"].asText()
        assertEquals(
            403,
            request("POST", "/imports/$uploadId/confirm", token, """{"unitId":"$first","accountId":"$accountId",$columns}""").statusCode(),
        )
        body(request("POST", "/imports/$uploadId/confirm", token, """{"unitId":"$second","accountId":"$accountId",$columns}"""))
        body(request("POST", "/imports/$uploadId/process", token))
        assertEquals(1, body(request("GET", "/imports/$uploadId/results", token)).size())
        val sharedMapping = """{"unitIds":["$first","$second"],"accountId":"$accountId",$columns}"""
        val denied = body(upload(token, "denied-scope.csv", csv, "bank"), 201)["id"].asText()
        assertEquals(403, request("POST", "/imports/$denied/confirm", token, sharedMapping).statusCode())
        body(
            request(
                "PATCH",
                "/users/$memberId",
                admin,
                """{"roles":["admin","ar","reconciliation"],"unitIds":["$first","$second"],"bankAccountIds":["$accountId"]}""",
            ),
        )
        val shared = body(upload(token, "all-units.csv", csv, "bank"), 201)["id"].asText()
        for (invalid in listOf(
            sharedMapping.replace("$first\",\"$second", "$first\",\"$first"),
            sharedMapping.replace("\"unitIds\"", "\"unitId\":\"$first\",\"unitIds\""),
            sharedMapping.replace("\"unitIds\"", "\"units\":{\"HQ\":\"$first\"},\"unitIds\""),
            sharedMapping.replace("\"booking_date\":", "\"unit\":\"Text\",\"booking_date\":"),
            sharedMapping.replace("\"$first\",\"$second\"", (1..101).joinToString(",") { "\"${UUID.randomUUID()}\"" }),
            sharedMapping.replace("\"$first\",\"$second\"", ""),
        )) {
            assertEquals(400, request("POST", "/imports/$shared/confirm", token, invalid).statusCode())
        }
        body(request("POST", "/imports/$shared/confirm", token, sharedMapping))
        body(request("POST", "/imports/$shared/confirm", token, sharedMapping))
        body(request("POST", "/imports/$shared/process", token))
        body(request("POST", "/imports/$shared/process", token))
        val sharedRows = body(request("GET", "/imports/$shared/results", token))
        assertEquals(1, sharedRows.size())
        val sharedBank = sharedRows[0]["id"].asText()
        body(request("PATCH", "/users/$memberId", admin, """{"unitIds":["$second"],"bankAccountIds":["$accountId"]}"""))
        val originalSource = UUID.fromString(body(request("GET", "/imports/$uploadId/results", token))[0]["source_id"].asText())
        assertThrows(org.springframework.dao.DataAccessException::class.java) {
            access.transaction(decoder.decode(token), tenant) { _, _ ->
                runtime.update(
                    """INSERT INTO finance.source_record (tenant_id,unit_id,batch_id,dataset_kind,category,locator,raw_text,account_id,statement_units)
                    SELECT tenant_id,unit_id,batch_id,dataset_kind,category,'forged',raw_text,account_id,?::uuid[]
                    FROM finance.source_record WHERE id=?""",
                    "{$first,$second}",
                    originalSource,
                )
            }
        }
        val secondOnly = body(request("GET", "/reconciliation", token))["banks"].single { it["id"].asText() == sharedBank }
        assertEquals(200, secondOnly["unallocated_minor"].asInt())
        assertTrue(secondOnly["can_propose"].asBoolean())
        assertEquals(listOf(second), secondOnly["statement_unit_ids"].toList().map { it.asText() })
        body(request("GET", "/reconciliation/banks/$sharedBank/details", token))
        val titleJob =
            body(
                upload(token, "shared-title.csv", "Name,Amount,Due,Ref\nShared account,2,2026-07-20,shared-ref\n", "receivable"),
                201,
            )["id"].asText()
        assertEquals(400, request("POST", "/imports/$titleJob/confirm", token, sharedMapping).statusCode())
        body(
            request(
                "POST",
                "/imports/$titleJob/confirm",
                token,
                """{"unitId":"$second","columns":{"party_name":"Name","amount":"Amount","due_on":"Due","external_id":"Ref"}}""",
            ),
        )
        body(request("POST", "/imports/$titleJob/process", token))
        val title = body(request("GET", "/imports/$titleJob/results", token))[0]["id"].asText()
        body(request("PATCH", "/users/$memberId", admin, """{"unitIds":["$first","$second"],"bankAccountIds":["$accountId"]}"""))
        val firstOnlyJob = body(upload(token, "first-only.csv", csv, "bank"), 201)["id"].asText()
        body(request("POST", "/imports/$firstOnlyJob/confirm", token, """{"unitIds":["$first"],"accountId":"$accountId",$columns}"""))
        body(request("POST", "/imports/$firstOnlyJob/process", token))
        val firstOnlyBank = body(request("GET", "/imports/$firstOnlyJob/results", token))[0]["id"].asText()
        assertFalse(body(request("GET", "/reconciliation/search/titles?bankId=$firstOnlyBank", token)).any { it["id"].asText() == title })
        assertEquals(
            400,
            request(
                "POST",
                "/reconciliation/$firstOnlyBank",
                token,
                """{"id":"${UUID.randomUUID()}","action":"draft","allocations":[{"titleId":"$title","amountMinor":100}]}""",
            ).statusCode(),
        )
        body(request("PATCH", "/users/$memberId", admin, """{"unitIds":["$second"],"bankAccountIds":["$accountId"]}"""))
        assertFalse(body(request("GET", "/reconciliation", token))["banks"].any { it["id"].asText() == firstOnlyBank })
        val proposal = UUID.randomUUID()
        body(
            request(
                "POST",
                "/reconciliation/$sharedBank",
                token,
                """{"id":"$proposal","action":"draft","allocations":[{"titleId":"$title","amountMinor":200}]}""",
            ),
        )
        assertEquals(
            second,
            owner.queryForObject("SELECT unit_id::text FROM finance.reconciliation_decision WHERE id=?", String::class.java, proposal),
        )
        val reviewer = login("controllership")
        val reviewerId = UUID.fromString(body(request("GET", "/me", reviewer))["id"].asText())
        owner.update("INSERT INTO finance.member_unit VALUES (?,?,?)", tenant, reviewerId, UUID.fromString(second))
        owner.update(
            "INSERT INTO finance.member_bank_account VALUES (?,?,?,?)",
            tenant,
            reviewerId,
            UUID.fromString(second),
            UUID.fromString(accountId),
        )
        owner.update(
            "INSERT INTO finance.approval_scope VALUES (?,?,?,'review_reconciliation')",
            tenant,
            reviewerId,
            UUID.fromString(second),
        )
        try {
            assertEquals(
                403,
                request("POST", "/reconciliation/decisions/$proposal/review", token, """{"decision":"confirmed"}""").statusCode(),
            )
            body(request("POST", "/reconciliation/decisions/$proposal/review", reviewer, """{"decision":"confirmed"}"""))
            val settled = body(request("GET", "/reconciliation", token))
            assertEquals(0, settled["banks"].single { it["id"].asText() == sharedBank }["unallocated_minor"].asInt())
            assertEquals(0, settled["titles"].single { it["id"].asText() == title }["outstanding_minor"].asInt())
            body(request("PATCH", "/users/$memberId", admin, """{"unitIds":["$first"],"bankAccountIds":["$accountId"]}"""))
            val firstView = body(request("GET", "/reconciliation", token))
            assertEquals(0, firstView["banks"].single { it["id"].asText() == sharedBank }["unallocated_minor"].asInt())
            assertFalse(firstView["titles"].any { it["id"].asText() == title })
            body(request("PATCH", "/users/$memberId", admin, """{"unitIds":["$second"],"bankAccountIds":["$accountId"]}"""))
            assertEquals(
                400,
                request(
                    "POST",
                    "/reconciliation/$sharedBank",
                    token,
                    """{"id":"${UUID.randomUUID()}","action":"draft","allocations":[{"titleId":"$title","amountMinor":1}]}""",
                ).statusCode(),
            )
            assertTrue(body(request("GET", "/reconciliation/search/banks?unitId=$second", token)).any { it["id"].asText() == sharedBank })
        } finally {
            owner.update("DELETE FROM finance.approval_scope WHERE member_id=? AND unit_id=?", reviewerId, UUID.fromString(second))
            owner.update("DELETE FROM finance.member_bank_account WHERE member_id=? AND unit_id=?", reviewerId, UUID.fromString(second))
            owner.update("DELETE FROM finance.member_unit WHERE member_id=? AND unit_id=?", reviewerId, UUID.fromString(second))
        }
        // Account visibility never grants access to an unselected statement unit.
        body(request("PATCH", "/users/$memberId", admin, """{"unitIds":["$first"],"bankAccountIds":[]}"""))
        assertFalse(body(request("GET", "/reconciliation", token))["banks"].any { it["id"].asText() == sharedBank })
        body(request("PATCH", "/users/$memberId", admin, """{"unitIds":["$second"],"bankAccountIds":["$accountId"]}"""))
        body(request("PATCH", "/bank-accounts/$accountId", admin, patch))
        assertEquals(1, body(request("GET", "/imports/$uploadId/results", token)).size())
        val next = body(upload(token, "shared-next.csv", csv, "bank"), 201)["id"].asText()
        assertEquals(
            403,
            request("POST", "/imports/$next/confirm", token, """{"unitId":"$second","accountId":"$accountId",$columns}""").statusCode(),
        )
    }

    @Test
    fun `tenant branding is public but provisioning never accepts tenant administrator tokens`() {
        assertEquals(200, request("GET", "/tenants").statusCode())
        for (token in listOf(null, login())) {
            assertEquals(401, request("GET", "/admin/tenants", token).statusCode())
            assertEquals(401, request("POST", "/admin/tenants", token, "{}").statusCode())
        }
        assertEquals(400, request("POST", "/signin/password", body = "{}").statusCode())
    }

    @Test
    fun `OIDC origin reaches PostgreSQL approval checks and ambiguous tenant identities fail closed`() {
        val id = owner.queryForObject("SELECT id FROM finance.membership WHERE email = 'ap@vantara.com.br'", UUID::class.java)!!
        owner.update("INSERT INTO finance.approval_scope VALUES (?, ?, ?, 'approve_payable')", tenant, id, unit)
        try {
            for ((client, human) in listOf(config.getProperty("cognito.client-id") to true, mcpClient to false)) {
                val jwt = decoder.decode(login("ap", client))
                access.transaction(jwt, tenant) { ctx, _ ->
                    assertEquals(
                        human,
                        runtime.queryForObject(
                            "SELECT finance.can_approve(?, ?, 'approve_payable')",
                            Boolean::class.java,
                            ctx.tenantId,
                            unit,
                        ),
                    )
                    true
                }
            }
        } finally {
            owner.update("DELETE FROM finance.approval_scope WHERE member_id = ?", id)
        }
        val otherTenant = UUID.randomUUID()
        val jwt = decoder.decode(login("ap"))
        owner.update("INSERT INTO finance.tenant VALUES (?, 'Other')", otherTenant)
        owner.update(
            "INSERT INTO finance.membership (tenant_id, issuer, subject) VALUES (?, ?, ?)",
            otherTenant,
            jwt.issuer.toString(),
            jwt.subject,
        )
        try {
            assertEquals(403, request("GET", "/me", jwt.tokenValue).statusCode())
            assertEquals(otherTenant.toString(), body(request("GET", "/me", jwt.tokenValue, tenantId = otherTenant))["tenant_id"].asText())
            body(request("GET", "/me", jwt.tokenValue, tenantId = tenant))
        } finally {
            owner.update("UPDATE finance.membership SET active = false WHERE tenant_id = ?", otherTenant)
        }
    }

    @Test
    fun `seed entrypoint runs as one shot and closes successfully`() {
        val path = Files.createTempFile("seed-entrypoint", ".properties")
        try {
            main(
                arrayOf(
                    "--spring.profiles.active=seed",
                    "--spring.datasource.url=${postgres.jdbcUrl}",
                    "--spring.datasource.username=${postgres.username}",
                    "--spring.datasource.password=${postgres.password}",
                    "--cognito.endpoint=$endpoint",
                    "--seed.config-path=$path",
                ),
            )
            assertTrue(Files.size(path) > 0)
        } finally {
            Files.delete(path)
        }
    }

    private fun request(
        method: String,
        path: String,
        token: String? = null,
        body: String? = null,
        tenantId: UUID? = null,
    ): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI("http://localhost:$port/api$path"))
        token?.let { builder.header("Authorization", "Bearer $it") }
        tenantId?.let { builder.header("X-Tenant-Id", it.toString()) }
        if (body != null) builder.header("Content-Type", "application/json")
        return http.send(
            builder.method(method, body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()).build(),
            HttpResponse.BodyHandlers.ofString(),
        )
    }

    private fun body(
        response: HttpResponse<String>,
        status: Int = 200,
    ): JsonNode {
        assertEquals(status, response.statusCode(), response.body())
        return json.readTree(response.body())
    }

    private fun login(
        role: String = "admin",
        client: String = config.getProperty("cognito.client-id"),
    ): String =
        cognito
            .initiateAuth {
                it.clientId(client).authFlow("USER_PASSWORD_AUTH").authParameters(
                    mapOf(
                        "USERNAME" to "$role@vantara.com.br",
                        "PASSWORD" to "@Test123",
                    ),
                )
            }.authenticationResult()
            .accessToken()

    @Test
    fun `development seed is repeatable and creates only tenant users and role grants`() {
        assertEquals(listOf(1, 6, 6, 0, 0, 0), seedCounts)
        assertEquals(
            "#175C4C",
            owner.queryForObject("SELECT primary_color FROM platform.tenant_registration WHERE id = ?", String::class.java, tenant),
        )
        assertEquals(
            listOf("vantara.com.br", "vantara.localhost"),
            owner.queryForList("SELECT domain FROM platform.tenant_domain WHERE tenant_id = ? ORDER BY domain", String::class.java, tenant),
        )
        assertEquals(
            6,
            cognito
                .listUsers {
                    it.userPoolId(config.getProperty("cognito.pool-id"))
                }.users()
                .count { user -> user.attributes().any { it.name() == "email" && it.value().endsWith("@vantara.com.br") } },
        )
        for (role in roles) {
            val me = body(request("GET", "/me", login(role)))
            assertEquals("$role@vantara.com.br", me["email"].asText())
            assertEquals(role, me["roles"][0].asText())
            assertEquals(0, me["approvalScopes"].size())
        }
    }

    @Test
    fun `custom local seed creates usable administrator and preserves existing branding on rerun`() {
        val id = UUID.randomUUID()
        val slug = "local-${id.toString().take(8)}"
        val email = "admin@$slug.test"
        val path = Files.createTempFile("tenant-seed", ".properties")
        val args =
            arrayOf(
                "--spring.profiles.active=seed",
                "--spring.datasource.url=${postgres.jdbcUrl}",
                "--spring.datasource.username=${postgres.username}",
                "--spring.datasource.password=${postgres.password}",
                "--cognito.endpoint=$endpoint",
                "--seed.config-path=$path",
                "--seed.tenant-id=$id",
                "--seed.tenant-slug=$slug",
                "--seed.tenant-name=Local tenant",
                "--seed.tenant-primary=#112233",
                "--seed.tenant-domains=$slug.localhost, portal.$slug.test",
                "--seed.admin-email=$email",
            )
        try {
            main(args)
            owner.update("UPDATE platform.tenant_registration SET name = 'Edited', primary_color = '#AABBCC' WHERE id = ?", id)
            main(args)
            assertEquals(
                "Edited",
                owner.queryForObject("SELECT name FROM platform.tenant_registration WHERE id = ?", String::class.java, id),
            )
            assertEquals(
                "#AABBCC",
                owner.queryForObject("SELECT primary_color FROM platform.tenant_registration WHERE id = ?", String::class.java, id),
            )
            assertEquals(2, owner.queryForObject("SELECT count(*) FROM platform.tenant_domain WHERE tenant_id = ?", Int::class.java, id))
            assertEquals(1, owner.queryForObject("SELECT count(*) FROM finance.membership WHERE tenant_id = ?", Int::class.java, id))
            val signin = request("POST", "/signin", body = """{"email":"$email","password":"@Test123"}""")
            val token = body(signin)["accessToken"].asText()
            assertEquals("admin", body(request("GET", "/me", token, tenantId = id))["roles"][0].asText())
            assertEquals(403, request("GET", "/me", token, tenantId = tenant).statusCode())
            val conflict = UUID.randomUUID()
            assertThrows(org.springframework.dao.DataAccessException::class.java) {
                DevelopmentSeed(
                    cognito,
                    owner,
                    CognitoProperties(endpoint = endpoint),
                    path.toString(),
                    conflict.toString(),
                    "conflict",
                    "Conflict",
                    "#112233",
                    "$slug.localhost",
                    "unused@local.test",
                ).run()
            }
            assertEquals(0, owner.queryForObject("SELECT count(*) FROM finance.tenant WHERE id = ?", Int::class.java, conflict))
        } finally {
            Files.deleteIfExists(path)
        }
    }

    @Test
    fun `signin authenticates against Floci and does not cache or expose failures`() {
        val response = request("POST", "/signin", body = """{"email":"admin@vantara.com.br","password":"@Test123"}""")
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElse(""))
        val token = body(response)["accessToken"].asText()
        body(request("GET", "/me", token))
        assertEquals(401, request("POST", "/signin", body = """{"email":"admin@vantara.com.br","password":"wrong"}""").statusCode())
        assertEquals(401, request("POST", "/signin", body = """{"email":"missing@vantara.com.br","password":"wrong"}""").statusCode())
        assertEquals(400, request("POST", "/signin", body = """{"email":"bad","password":""}""").statusCode())
        assertEquals(401, request("GET", "/me").statusCode())
        assertEquals(401, request("POST", "/users", body = "{}").statusCode())
        assertEquals(401, request("GET", "/users").statusCode())
        assertEquals(401, request("GET", "/me", "invalid").statusCode())
        assertEquals("Invalid request", body(request("POST", "/signin", body = "{bad json"), 400)["error"].asText())
    }

    @Test
    fun `all management routes require admin for every role`() {
        val admin = login()
        assertEquals(6, body(request("GET", "/users/roles", admin)).size())
        val id = body(request("GET", "/me", admin))["id"].asText()
        for (role in roles - "admin") {
            val token = login(role)
            for ((method, path, payload) in listOf(
                Triple("GET", "/users", null),
                Triple("GET", "/users/roles", null),
                Triple("GET", "/users/$id", null),
                Triple("POST", "/users", """{"email":"unused@example.com","password":"@Test123","roles":["ap"]}"""),
                Triple("PATCH", "/users/$id", "{}"),
                Triple("DELETE", "/users/$id", null),
            )) {
                assertEquals(403, request(method, path, token, payload).statusCode(), "$role $method $path")
            }
        }
    }

    @Test
    fun `admin manages users and deactivation immediately invalidates existing tokens`() {
        val admin = login()
        val email = "${UUID.randomUUID()}@example.com"
        val created =
            body(
                request(
                    "POST",
                    "/users",
                    admin,
                    """{"email":"$email","password":"@Test123","displayName":"Example","roles":["ap"],"unitIds":["$unit"],"bankAccountIds":["$account"]}""",
                ),
                201,
            )
        val id = created["id"].asText()
        val token =
            cognito
                .initiateAuth {
                    it.clientId(config.getProperty("cognito.client-id")).authFlow("USER_PASSWORD_AUTH").authParameters(
                        mapOf(
                            "USERNAME" to email,
                            "PASSWORD" to "@Test123",
                        ),
                    )
                }.authenticationResult()
                .accessToken()
        assertEquals("Example", body(request("GET", "/users/$id", admin))["display_name"].asText())
        body(request("GET", "/me", token))
        val patched =
            body(
                request(
                    "PATCH",
                    "/users/$id",
                    admin,
                    """{"displayName":"Renamed","roles":["ar"],"active":true,"unitIds":["$unit"],"bankAccountIds":[]}""",
                ),
            )
        assertEquals("ar", patched["roles"][0].asText())
        assertEquals("Renamed", patched["display_name"].asText())
        body(request("PATCH", "/users/$id", admin, "{}"))
        assertEquals(1, body(request("GET", "/users?limit=1&offset=0", admin)).size())
        assertEquals(0, body(request("GET", "/users?offset=10000", admin)).size())
        assertEquals(400, request("GET", "/users?offset=-1", admin).statusCode())
        assertEquals(400, request("GET", "/users?limit=101", admin).statusCode())
        assertEquals(400, request("GET", "/users?limit=0", admin).statusCode())
        assertEquals(204, request("DELETE", "/users/$id", admin).statusCode())
        assertEquals(403, request("GET", "/me", token).statusCode())
        assertFalse(body(request("GET", "/users/$id", admin))["active"].asBoolean())
        body(request("PATCH", "/users/$id", admin, """{"active":true,"unitIds":[],"roles":["fpa"]}"""))
        assertEquals(0, body(request("GET", "/me", token))["unitIds"].size())
        assertEquals(409, request("POST", "/users", admin, """{"email":"$email","password":"@Test123","roles":["ap"]}""").statusCode())
    }

    @Test
    fun `tenant unit and account boundaries prevent escalation and clean up failed Cognito creation`() {
        val admin = login()
        val me = body(request("GET", "/me", admin))
        val own = me["id"].asText()
        assertEquals(403, request("PATCH", "/users/$own", admin, """{"roles":["ap"]}""").statusCode())
        assertEquals(403, request("DELETE", "/users/$own", admin).statusCode())
        assertEquals(404, request("GET", "/users/${UUID.randomUUID()}", admin).statusCode())
        assertEquals(403, request("GET", "/me", admin, tenantId = UUID.randomUUID()).statusCode())
        body(request("GET", "/me", admin, tenantId = tenant))
        assertEquals(400, request("POST", "/users", admin, """{"email":"bad","password":"x","roles":[]}""").statusCode())
        assertEquals(
            400,
            request("POST", "/users", admin, """{"email":"bad@example.com","password":"@Test123","roles":["root"]}""").statusCode(),
        )
        for (scope in listOf("\"unitIds\":[\"$otherUnit\"]", "\"bankAccountIds\":[\"${UUID.randomUUID()}\"]")) {
            val email = "${UUID.randomUUID()}@example.com"
            assertEquals(
                403,
                request("POST", "/users", admin, """{"email":"$email","password":"@Test123","roles":["ar"],$scope}""").statusCode(),
            )
            assertFalse(cognito.listUsers { it.userPoolId(config.getProperty("cognito.pool-id")) }.users().any { it.username() == email })
            assertEquals(0, owner.queryForObject("SELECT count(*) FROM finance.membership WHERE email = ?", Int::class.java, email))
        }
        val restricted = UUID.randomUUID()
        owner.update(
            "INSERT INTO finance.membership (tenant_id, id, issuer, subject) VALUES (?, ?, ?, ?)",
            tenant,
            restricted,
            config.getProperty("cognito.issuer"),
            restricted.toString(),
        )
        owner.update("INSERT INTO finance.member_unit VALUES (?, ?, ?)", tenant, restricted, otherUnit)
        assertEquals(404, request("GET", "/users/$restricted", admin).statusCode())
        assertEquals(404, request("PATCH", "/users/$restricted", admin, "{}").statusCode())
        assertEquals(404, request("DELETE", "/users/$restricted", admin).statusCode())
    }

    @Test
    fun `delegated OIDC uses same membership with AI origin and rejects ID or unrelated client tokens`() {
        val delegated = body(request("GET", "/me", login("ap", mcpClient)))
        assertEquals("ai", delegated["actorKind"].asText())
        assertEquals("ap", delegated["roles"][0].asText())
        assertEquals(0, delegated["approvalScopes"].size())
        assertEquals(403, request("GET", "/users", login("ap", mcpClient)).statusCode())
        val result =
            cognito
                .initiateAuth {
                    it.clientId(config.getProperty("cognito.client-id")).authFlow("USER_PASSWORD_AUTH").authParameters(
                        mapOf(
                            "USERNAME" to "ap@vantara.com.br",
                            "PASSWORD" to "@Test123",
                        ),
                    )
                }.authenticationResult()
        assertEquals(401, request("GET", "/me", result.idToken()).statusCode())
        assertEquals(401, request("GET", "/me", login("ap", rogueClient)).statusCode())
        val token = result.accessToken()
        assertEquals(401, request("GET", "/me", token.substringBeforeLast('.') + ".AAAAAAAA").statusCode())
    }

    @Test
    fun `reconciliation uses imported evidence and enforces independent review balances and account scope`() {
        val ar = login("ar")
        val reconciler = login("reconciliation")
        val reviewer = login("controllership")
        val reviewerId = UUID.fromString(body(request("GET", "/me", reviewer))["id"].asText())
        val grantedUnits = mutableSetOf<UUID>()
        owner.update("INSERT INTO finance.approval_scope VALUES (?,?,?,'review_reconciliation')", tenant, reviewerId, unit)

        fun importFile(
            name: String,
            kind: String,
            token: String,
        ): List<String> {
            val text =
                Files.readString(
                    java.nio.file.Path
                        .of("../../data_pack/$name"),
                )
            val id = body(upload(token, name, text, kind), 201)["id"].asText()
            body(request("POST", "/imports/$id/confirm", token, """{"unitId":"$unit","accountId":"$account"}"""))
            body(request("POST", "/imports/$id/process", token))
            return body(request("GET", "/imports/$id/results?limit=100", token)).toList().map { it["id"].asText() }
        }
        try {
            val titleIds = importFile("01_contas_a_receber_protheus_jul2026.csv", "receivable", ar)
            importFile("02_titulos_unidade_norte_omie_jul2026.csv", "receivable", ar)
            val bankIds = importFile("03_extrato_bancario_jul2026.csv", "bank", reconciler)
            val workspace = body(request("GET", "/reconciliation", ar))
            assertFalse(workspace["banks"].any { it["direction"].asText() == "debit" })
            assertTrue(body(request("GET", "/reconciliation", reconciler))["banks"].any { it["direction"].asText() == "debit" })
            assertEquals(0, body(request("GET", "/reconciliation", login("fpa")))["titles"].size())
            assertEquals(403, request("GET", "/reconciliation", ar, tenantId = UUID.randomUUID()).statusCode())
            val bank = bankIds[3]
            val first = titleIds[2]
            val second = titleIds[9]
            assertTrue(workspace["candidates"].any { it["bankId"].asText() == bank && it["titleId"].asText() == first })
            val details = body(request("GET", "/reconciliation/banks/$bank/details", ar))
            assertEquals("record:5", details["source"]["locator"].asText())
            assertTrue(details["source"]["raw_text"].asText().contains("DOCE PONTO"))
            assertEquals(400, request("GET", "/reconciliation/unknown/$bank/details", ar).statusCode())
            assertEquals(404, request("GET", "/reconciliation/banks/${UUID.randomUUID()}/details", ar).statusCode())

            fun proposal(
                bankId: String,
                entries: String,
                action: String = "draft",
                id: UUID = UUID.randomUUID(),
            ): Pair<UUID, HttpResponse<String>> =
                id to request("POST", "/reconciliation/$bankId", ar, """{"id":"$id","action":"$action","allocations":[$entries]}""")

            fun allocation(
                id: String,
                value: Long,
            ): String = """{"titleId":"$id","amountMinor":$value}"""
            assertEquals(
                403,
                request(
                    "POST",
                    "/reconciliation/$bank",
                    reviewer,
                    """{"id":"${UUID.randomUUID()}","action":"pending"}""",
                ).statusCode(),
            )
            assertEquals(400, proposal(bank, "", "unknown").second.statusCode())
            assertEquals(400, proposal(bank, "", "rejected_suggestion").second.statusCode())
            assertEquals(
                400,
                proposal(bank, (1..101).joinToString(",") { allocation(UUID.randomUUID().toString(), 1) }).second.statusCode(),
            )
            assertEquals(404, proposal(bank, allocation(UUID.randomUUID().toString(), 1)).second.statusCode())
            assertEquals(
                200,
                request(
                    "POST",
                    "/reconciliation/${bankIds[5]}",
                    reconciler,
                    """{"id":"${UUID.randomUUID()}","action":"pending"}""",
                ).statusCode(),
            )
            assertEquals(
                404,
                request(
                    "POST",
                    "/reconciliation/decisions/${UUID.randomUUID()}/review",
                    reviewer,
                    """{"decision":"confirmed"}""",
                ).statusCode(),
            )
            assertEquals(
                400,
                request(
                    "POST",
                    "/reconciliation/decisions/${UUID.randomUUID()}/review",
                    reviewer,
                    """{"decision":"unknown"}""",
                ).statusCode(),
            )
            body(
                request(
                    "POST",
                    "/reconciliation/${bankIds[0]}",
                    ar,
                    """{"id":"${UUID.randomUUID()}","action":"rejected_suggestion","rejectedTitleId":"${titleIds[0]}"}""",
                ),
            )
            assertEquals(
                400,
                request(
                    "POST",
                    "/reconciliation/${bankIds[0]}",
                    ar,
                    """{"id":"${UUID.randomUUID()}","action":"rejected_suggestion","rejectedTitleId":"$first"}""",
                ).statusCode(),
            )
            assertEquals(400, proposal(bank, allocation(first, 4278051)).second.statusCode())
            assertEquals(400, proposal(bank, allocation(first, 0)).second.statusCode())
            assertEquals(400, proposal(bank, allocation(first, 1) + "," + allocation(first, 1)).second.statusCode())
            assertEquals(400, proposal(bank, "").second.statusCode())
            assertEquals(404, proposal(bankIds[5], allocation(first, 1)).second.statusCode())
            val (id, saved) = proposal(bank, allocation(first, 4278050) + "," + allocation(second, 485000))
            body(saved)
            assertEquals(2, owner.queryForObject("SELECT count(*) FROM finance.allocation WHERE decision_id=?", Int::class.java, id))
            assertEquals(
                403,
                request("POST", "/reconciliation/decisions/$id/review", reviewer, """{"decision":"confirmed"}""").statusCode(),
            )
            for (titleId in titleIds) {
                val titleUnit =
                    owner.queryForObject(
                        "SELECT unit_id FROM finance.title WHERE id=?",
                        UUID::class.java,
                        UUID.fromString(titleId),
                    )
                if (owner.update("INSERT INTO finance.member_unit VALUES (?,?,?) ON CONFLICT DO NOTHING", tenant, reviewerId, titleUnit) ==
                    1
                ) {
                    grantedUnits.add(titleUnit!!)
                }
                owner.update(
                    "INSERT INTO finance.approval_scope VALUES (?,?,?,'review_reconciliation') ON CONFLICT DO NOTHING",
                    tenant,
                    reviewerId,
                    titleUnit,
                )
            }
            assertEquals(409, proposal(bank, allocation(first, 1), id = id).second.statusCode())
            assertEquals(403, request("POST", "/reconciliation/decisions/$id/review", ar, """{"decision":"confirmed"}""").statusCode())
            body(request("POST", "/reconciliation/decisions/$id/review", reviewer, """{"decision":"confirmed"}"""))
            assertEquals(409, request("POST", "/reconciliation/decisions/$id/review", reviewer, """{"decision":"rejected"}""").statusCode())
            val after = body(request("GET", "/reconciliation", ar))
            assertEquals(0, after["banks"].first { it["id"].asText() == bank }["unallocated_minor"].asLong())
            assertEquals("confirmed", after["decisions"].first { it["id"].asText() == id.toString() }["review"].asText())
            assertEquals(400, proposal(bank, allocation(second, 1)).second.statusCode())
            assertEquals(400, proposal(bankIds[6], allocation(titleIds[6], 6250001)).second.statusCode())
            val partial = proposal(bankIds[6], allocation(titleIds[6], 6250000))
            body(partial.second)
            body(request("POST", "/reconciliation/decisions/${partial.first}/review", reviewer, """{"decision":"confirmed"}"""))
            val balance = body(request("GET", "/reconciliation/titles/${titleIds[6]}/details", ar))
            assertEquals(6250000, balance["normalized"]["outstanding_minor"].asLong())
            val unknown = bankIds[14]
            val equal =
                workspace["titles"]
                    .first {
                        it["source_system"].asText() == "omie" &&
                            it["original_amount_minor"].asLong() == 567000L
                    }["id"]
                    .asText()
            assertFalse(workspace["candidates"].any { it["bankId"].asText() == unknown })
            val ambiguous = proposal(unknown, allocation(equal, 567000))
            body(ambiguous.second)
            assertEquals(
                400,
                request(
                    "POST",
                    "/reconciliation/decisions/${ambiguous.first}/review",
                    reviewer,
                    """{"decision":"confirmed"}""",
                ).statusCode(),
            )
            body(request("POST", "/reconciliation/decisions/${ambiguous.first}/review", reviewer, """{"decision":"rejected"}"""))
            val pending = proposal(unknown, "", "pending")
            body(pending.second)
            assertEquals(
                400,
                request("POST", "/reconciliation/decisions/${pending.first}/review", reviewer, """{"decision":"confirmed"}""").statusCode(),
            )
            assertEquals(
                409,
                request(
                    "POST",
                    "/reconciliation/decisions/${ambiguous.first}/review",
                    reviewer,
                    """{"decision":"rejected"}""",
                ).statusCode(),
            )
            val member = UUID.fromString(workspace["actorId"].asText())
            owner.update("DELETE FROM finance.member_bank_account WHERE member_id=? AND account_id=?", member, account)
            try {
                assertEquals(404, request("GET", "/reconciliation/banks/$bank/details", ar).statusCode())
                assertFalse(body(request("GET", "/reconciliation", ar))["decisions"].any { it["id"].asText() == id.toString() })
            } finally {
                owner.update("INSERT INTO finance.member_bank_account VALUES (?,?,?,?)", tenant, member, unit, account)
            }
        } finally {
            owner.update("DELETE FROM finance.approval_scope WHERE member_id=? AND permission='review_reconciliation'", reviewerId)
            for (granted in grantedUnits) {
                owner.update(
                    "DELETE FROM finance.member_unit WHERE member_id=? AND unit_id=?",
                    reviewerId,
                    granted,
                )
            }
        }
    }

    @Test
    fun `agents propose payable and receivable matches but only independent humans settle balances`() {
        val agent = login("reconciliation", mcpClient)
        val reviewer = login("controllership")
        val reviewerId = UUID.fromString(body(request("GET", "/me", reviewer))["id"].asText())
        owner.update("INSERT INTO finance.approval_scope VALUES (?,?,?,'review_reconciliation')", tenant, reviewerId, unit)
        try {
            for ((kind, direction) in listOf("payable" to "debit", "receivable" to "credit")) {
                val supplier = "Agent Vendor ${UUID.randomUUID()}"

                fun imported(
                    dataset: String,
                    csv: String,
                    columns: String,
                ): String {
                    val importer = if (dataset == "bank") agent else login(if (dataset == "payable") "ap" else "ar")
                    val id = body(upload(importer, "agent-${UUID.randomUUID()}.csv", csv, dataset), 201)["id"].asText()
                    body(
                        request(
                            "POST",
                            "/imports/$id/confirm",
                            importer,
                            """{"unitId":"$unit","accountId":"$account","dateFormat":"uuuu-MM-dd","decimal":".","columns":{$columns}}""",
                        ),
                    )
                    body(request("POST", "/imports/$id/process", importer))
                    return body(request("GET", "/imports/$id/results", importer))[0]["id"].asText()
                }
                val title =
                    imported(
                        kind,
                        "Name,Due,Total\n$supplier,2026-07-20,12.50",
                        """"party_name":"Name","due_on":"Due","amount":"Total"""",
                    )
                val bank =
                    imported(
                        "bank",
                        "Name,Date,Total,Direction\n$supplier,2026-07-20,12.50,$direction",
                        """"description":"Name","booking_date":"Date","amount":"Total","direction":"Direction"""",
                    )
                val search = "name=${java.net.URLEncoder.encode(
                    supplier,
                    Charsets.UTF_8,
                )}&from=2026-07-20&to=2026-07-20&minAmountMinor=1250&maxAmountMinor=1250&unitId=$unit&limit=10"
                assertEquals(
                    listOf(
                        title,
                    ),
                    body(request("GET", "/reconciliation/search/titles?$search&direction=$kind", agent)).toList().map {
                        it["id"].asText()
                    },
                )
                assertEquals(
                    listOf(
                        bank,
                    ),
                    body(request("GET", "/reconciliation/search/banks?$search&direction=$direction", agent)).toList().map {
                        it["id"].asText()
                    },
                )
                val candidates = body(request("GET", "/reconciliation/search/titles?$search&bankId=$bank", agent))
                assertEquals(title, candidates[0]["id"].asText())
                assertTrue(candidates[0]["identityEvidence"].size() > 0)
                assertTrue(candidates[0]["amountMatches"].asBoolean())
                assertEquals(0, candidates[0]["dateDifferenceDays"].asInt())
                assertEquals(0, body(request("GET", "/reconciliation/search/titles?$search", login("fpa", mcpClient))).size())
                assertEquals(
                    0,
                    body(
                        request(
                            "GET",
                            "/reconciliation/search/titles?name=${java.net.URLEncoder.encode(
                                supplier,
                                Charsets.UTF_8,
                            )}&minAmountMinor=1251",
                            agent,
                        ),
                    ).size(),
                )
                for (query in listOf(
                    "limit=101",
                    "minAmountMinor=-1",
                    "minAmountMinor=20&maxAmountMinor=10",
                    "from=2027-01-01&to=2026-01-01",
                    "direction=unknown",
                )) {
                    assertEquals(400, request("GET", "/reconciliation/search/titles?$query", agent).statusCode())
                }
                val id = UUID.randomUUID()
                val payload = """{"id":"$id","action":"draft","allocations":[{"titleId":"$title","amountMinor":1250}]}"""
                body(request("POST", "/reconciliation/$bank", agent, payload))
                val pending = body(request("GET", "/reconciliation", reviewer))
                val proposal = pending["decisions"].first { it["id"].asText() == id.toString() }
                assertEquals("ai", proposal["origin"].asText())
                assertTrue(proposal["review"].isNull)
                assertEquals(
                    listOf(
                        id.toString(),
                    ),
                    body(request("GET", "/reconciliation/search/decisions?bankId=$bank&state=pending", agent)).toList().map {
                        it["id"].asText()
                    },
                )
                assertTrue(pending["titles"].any { it["id"].asText() == title })
                assertTrue(pending["candidates"].any { it["bankId"].asText() == bank && it["titleId"].asText() == title })
                assertEquals(
                    1250,
                    body(request("GET", "/reconciliation/banks/$bank/details", agent))["normalized"]["unallocated_minor"].asInt(),
                )
                assertEquals(
                    403,
                    request(
                        "POST",
                        "/reconciliation/decisions/$id/review",
                        login("controllership", mcpClient),
                        """{"decision":"confirmed"}""",
                    ).statusCode(),
                )
                assertEquals(
                    403,
                    request(
                        "POST",
                        "/reconciliation/decisions/$id/review",
                        login("reconciliation"),
                        """{"decision":"confirmed"}""",
                    ).statusCode(),
                )
                body(request("POST", "/reconciliation/decisions/$id/review", reviewer, """{"decision":"confirmed"}"""))
                assertEquals(
                    0,
                    body(request("GET", "/reconciliation/banks/$bank/details", agent))["normalized"]["unallocated_minor"].asInt(),
                )
                assertEquals(
                    0,
                    body(request("GET", "/reconciliation/titles/$title/details", agent))["normalized"]["outstanding_minor"].asInt(),
                )
            }
        } finally {
            owner.update("DELETE FROM finance.approval_scope WHERE member_id=? AND permission='review_reconciliation'", reviewerId)
        }
    }

    companion object {
        private val roles = listOf("admin", "ap", "ar", "reconciliation", "controllership", "fpa")
        private val postgres = PostgreSQLContainer("postgres:17-alpine").apply { start() }
        private val floci =
            GenericContainer(
                "floci/floci:2.3.0",
            ).withExposedPorts(4566).waitingFor(Wait.forHttp("/health").forPort(4566)).apply {
                start()
            }
        private val endpoint = "http://${floci.host}:${floci.getMappedPort(4566)}"
        private val s3 =
            software.amazon.awssdk.services.s3.S3Client
                .builder()
                .endpointOverride(URI(endpoint))
                .forcePathStyle(true)
                .region(
                    Region.US_EAST_1,
                ).credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .build()
        private val cognito =
            CognitoIdentityProviderClient
                .builder()
                .endpointOverride(URI(endpoint))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .build()
        private val owner = JdbcTemplate(DriverManagerDataSource(postgres.jdbcUrl, postgres.username, postgres.password))
        private val config = Properties()
        private val tenant = UUID.fromString("ce19c2fb-b199-4b58-a274-113cd07ce416")
        private val unit = UUID.randomUUID()
        private val otherUnit = UUID.randomUUID()
        private val account = UUID.randomUUID()
        private val seedCounts: List<Int?>
        private val mcpClient: String
        private val rogueClient: String

        init {
            s3.createBucket { it.bucket("vantara-ingestion-local") }
            s3.putBucketVersioning { it.bucket("vantara-ingestion-local").versioningConfiguration { c -> c.status("Enabled") } }
            System.setProperty("aws.accessKeyId", "test")
            System.setProperty("aws.secretAccessKey", "test")
            Flyway
                .configure()
                .dataSource(postgres.jdbcUrl, postgres.username, postgres.password)
                .placeholders(mapOf("appPassword" to "testRuntimePassword"))
                .load()
                .migrate()
            val path = Files.createTempFile("cognito-test", ".properties")
            val seed = DevelopmentSeed(cognito, owner, CognitoProperties(endpoint = endpoint), path.toString())
            seed.run()
            seed.run()
            Files.newInputStream(path).use(config::load)
            Files.delete(path)
            seedCounts =
                listOf("tenant", "membership", "member_role", "business_unit", "bank_account", "title")
                    .map { owner.queryForObject("SELECT count(*) FROM finance.$it", Int::class.java) }
            owner.update("INSERT INTO finance.business_unit VALUES (?, ?, 'Unit'), (?, ?, 'Other')", tenant, unit, tenant, otherUnit)
            owner.update("INSERT INTO finance.member_unit SELECT tenant_id, id, ? FROM finance.membership", unit)
            owner.update("INSERT INTO finance.bank_account VALUES (?, ?, ?, '341', 'test', 'BRL')", tenant, unit, account)
            owner.update("INSERT INTO finance.member_bank_account SELECT tenant_id, id, ?, ? FROM finance.membership", unit, account)

            fun client(name: String): String =
                cognito
                    .createUserPoolClient {
                        it
                            .userPoolId(
                                config.getProperty("cognito.pool-id"),
                            ).clientName(name)
                            .explicitAuthFlowsWithStrings("ALLOW_USER_PASSWORD_AUTH")
                    }.userPoolClient()
                    .clientId()
            mcpClient = client("test-delegated")
            rogueClient = client("untrusted")
        }

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username") { "app_user" }
            registry.add("spring.datasource.password") { "testRuntimePassword" }
            config.forEach { (key, value) -> registry.add(key.toString()) { value } }
            registry.add("cognito.endpoint") { endpoint }
            registry.add("ingestion.endpoint") { endpoint }
            registry.add("cognito.mcp-client-id") { mcpClient }
        }
    }
}
