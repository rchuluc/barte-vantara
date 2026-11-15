package com.barte.vantara.finance

import org.apache.commons.csv.CSVFormat
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration

@Component
@Profile("!migrate & !seed")
class ImportFiles(
    @Value("\${ingestion.bucket:vantara-ingestion-local}") private val bucket: String,
    @Value("\${ingestion.endpoint:}") endpoint: String,
    @Value("\${cognito.region}") region: String,
) : AutoCloseable {
    private val s3 =
        S3Client
            .builder()
            .region(Region.of(region))
            .overrideConfiguration { it.apiCallTimeout(Duration.ofMinutes(5)).apiCallAttemptTimeout(Duration.ofMinutes(2)) }
            .apply { if (endpoint.isNotBlank()) endpointOverride(URI(endpoint)).forcePathStyle(true) }
            .build()

    fun put(
        key: String,
        path: Path,
        hash: String,
    ): String =
        s3
            .putObject({
                it
                    .bucket(bucket)
                    .key(key)
                    .contentType("application/octet-stream")
                    .metadata(mapOf("sha256" to hash))
            }, RequestBody.fromFile(path))
            .versionId()
            ?.takeUnless { it == "null" }
            ?: throw org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                "Ingestion bucket must have versioning enabled",
            )

    fun open(
        key: String,
        version: String,
    ): java.io.InputStream = s3.getObject { it.bucket(bucket).key(key).versionId(version) }

    override fun close() = s3.close()
}

internal object StructuredFiles {
    val profiles =
        mapOf(
            "protheus" to
                listOf("cliente", "cnpj", "unidade", "documento", "nosso_numero", "tipo", "emissao", "vencimento", "valor", "status"),
            "omie" to listOf("customer_name", "tax_id", "invoice_ref", "due_date", "amount", "paid_flag"),
            "itau" to listOf("data", "historico", "documento", "valor", "tipo"),
        )

    fun read(
        path: Path,
        xlsx: Boolean,
        consume: (Long, List<String>) -> Unit,
    ) {
        if (xlsx) {
            readWorkbook(path, consume)
            return
        }
        val first = Files.newBufferedReader(path).use { it.readLine().orEmpty() }
        val delimiter = if (first.count { it == ';' } > first.count { it == ',' }) ';' else ','
        Files.newBufferedReader(path).use { reader ->
            CSVFormat.RFC4180.builder().setDelimiter(delimiter).setIgnoreEmptyLines(true).get().parse(reader).use { parser ->
                for (record in parser) {
                    require(record.size() in 1..100) { "Expected 1 to 100 columns" }
                    val cells = record.toList().map { it.removePrefix("\uFEFF") }
                    require(cells.all { it.length <= 16384 }) { "Cell exceeds 16384 characters" }
                    consume(record.recordNumber, cells)
                }
            }
        }
    }

    private fun readWorkbook(
        path: Path,
        consume: (Long, List<String>) -> Unit,
    ) {
        // Sheets stream through SAX; bound auxiliary tables before POI materializes them.
        java.util.zip.ZipFile(path.toFile()).use { zip ->
            for (entry in zip.entries()) {
                require(entry.size in 0..(256L * 1024 * 1024)) { "XLSX part exceeds 256 MiB" }
                if (entry.name.endsWith("sharedStrings.xml") || entry.name.endsWith("styles.xml")) {
                    require(entry.size <= 16L * 1024 * 1024) { "XLSX shared strings or styles exceed 16 MiB; split the workbook" }
                }
            }
        }
        org.apache.poi.openxml4j.opc.OPCPackage.open(path.toFile(), org.apache.poi.openxml4j.opc.PackageAccess.READ).use { pkg ->
            val reader =
                org.apache.poi.xssf.eventusermodel
                    .XSSFReader(pkg)
            reader.setUseReadOnlySharedStringsTable(true)
            val sheets = reader.sheetsData
            require(sheets.hasNext()) { "Workbook has no worksheets" }
            sheets.next().use { sheet ->
                require(!sheets.hasNext()) { "Upload one worksheet per workbook" }
                var cells = mutableListOf<String>()
                var width = 0
                var brazilian = false
                var date1904 = false
                val workbookXml =
                    org.apache.poi.util.XMLHelper
                        .newXMLReader()
                workbookXml.contentHandler =
                    object : org.xml.sax.helpers.DefaultHandler() {
                        override fun startElement(
                            uri: String?,
                            localName: String?,
                            qName: String?,
                            attributes: org.xml.sax.Attributes,
                        ) {
                            if (localName == "workbookPr") date1904 = attributes.getValue("date1904") in setOf("1", "true")
                        }
                    }
                reader.workbookData.use { workbookXml.parse(org.xml.sax.InputSource(it)) }
                val formatter =
                    object : org.apache.poi.ss.usermodel.DataFormatter(java.util.Locale.US) {
                        override fun formatRawCellContents(
                            value: Double,
                            formatIndex: Int,
                            formatString: String,
                        ): String {
                            if (org.apache.poi.ss.usermodel.DateUtil
                                    .isADateFormat(formatIndex, formatString)
                            ) {
                                val date =
                                    org.apache.poi.ss.usermodel.DateUtil
                                        .getLocalDateTime(value, date1904)
                                        .toLocalDate()
                                return if (brazilian) {
                                    date.format(
                                        java.time.format.DateTimeFormatter
                                            .ofPattern("dd/MM/uuuu"),
                                    )
                                } else {
                                    date.toString()
                                }
                            }
                            // Numeric formats must not round away fractional cents before validation.
                            if (formatString.matches(Regex("0{2,}")) && value % 1 == 0.0) {
                                return super.formatRawCellContents(value, formatIndex, formatString)
                            }
                            val number =
                                java.math.BigDecimal
                                    .valueOf(value)
                                    .stripTrailingZeros()
                                    .toPlainString()
                            return if (brazilian) number.replace('.', ',') else number
                        }
                    }
                val handler =
                    object : org.apache.poi.xssf.eventusermodel.XSSFSheetXMLHandler.SheetContentsHandler {
                        override fun startRow(rowNum: Int) {
                            cells = mutableListOf()
                        }

                        override fun cell(
                            reference: String,
                            value: String?,
                            comment: org.apache.poi.xssf.usermodel.XSSFComment?,
                        ) {
                            val column =
                                org.apache.poi.ss.util
                                    .CellReference(reference)
                                    .col
                                    .toInt()
                            require(column < 100 && (value?.length ?: 0) <= 16384) { "XLSX cell exceeds column or text limits" }
                            while (cells.size <= column) cells.add("")
                            cells[column] = value.orEmpty()
                        }

                        override fun endRow(rowNum: Int) {
                            if (rowNum == 0) {
                                width = cells.size
                                brazilian = listOf("protheus", "itau").any { profiles[it]!!.toSet() == cells.toSet() }
                            }
                            while (cells.size < width) cells.add("")
                            consume(rowNum.toLong() + 1, cells)
                        }
                    }
                val xml =
                    org.apache.poi.util.XMLHelper
                        .newXMLReader()
                xml.contentHandler =
                    org.apache.poi.xssf.eventusermodel.XSSFSheetXMLHandler(
                        reader.stylesTable,
                        reader.sharedStringsTable,
                        handler,
                        formatter,
                        false,
                    )
                xml.parse(org.xml.sax.InputSource(sheet))
            }
        }
    }
}
