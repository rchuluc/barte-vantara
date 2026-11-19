# Structured ingestion API

All routes are under `/api`, require a verified Cognito access token, and accept
`X-Tenant-Id` when the identity belongs to multiple tenants. Tenant selection is
checked against active database membership; the header grants no authority.

## Workflow

The UI first calls `POST /imports/preview` with raw file bytes and the same query
parameters. This temporary preview detects Protheus/Omie as `receivable` and Itaú
as `bank` from headers, overriding the selected kind for recognized formats.
Custom files retain the selected kind. Permission for the detected kind is checked
before returning the preview. `targetFields` contains only fields for that dataset.
On confirmation, the UI uploads using the preview's detected `dataset_kind`.
Itaú requires a destination bank account and produces `finance.bank_entry` records,
with source/import evidence, rather than `finance.title` receivables.

1. `POST /imports?filename=report.csv&kind=receivable` with the **raw file body**
   (`application/octet-stream`). Supported kinds: `receivable`, `payable`, `bank`.
   Send a fresh UUID in `Idempotency-Key` and retain it across network retries.
   Reusing a key returns its original job; it does not replace the original file.
   Returns `201` with an import ID, state, detected platform, headers,
   `suggestedColumns`, and `targetFields`.
2. `GET /imports/{id}/rows?after=0&limit=20` previews the original cells, row
   numbers, errors, and corrections. `GET /business-units` lists authorized units.
3. `POST /imports/{id}/confirm` records the mapping and authorized destinations.
   Known formats get suggested mappings based on **headers**, never filenames.
   Unknown reports require explicit mappings. Confirmation does not write titles.
4. Call `POST /imports/{id}/process` until `state` is `completed`. Each request
   commits at most 500 rows and releases its database transaction. This is a
   **client-driven resumable workflow**, not an in-memory background task.
   Concurrent requests serialize on the job; retries cannot duplicate accepted rows.
5. `GET /imports/{id}` returns counters; `processed` includes accepted and rejected
   rows. `GET /imports/{id}/results?after=0&limit=50` returns persisted titles or bank
   entries with row numbers. Row/result pagination is keyset-based, max 500.
6. `PATCH /imports/{id}/rows/{row_number}` accepts a JSON array of corrected cells
   for a rejected row, in original header order. Process again. Accepted rows cannot
   be edited through this route. Original cells and the original S3 version remain
   unchanged; corrections and state changes are audited.

`GET /imports?offset=0&limit=50` discovers the caller's jobs after a lost response.
`GET /imports/{id}/file` streams the exact original S3 version with `no-store` and
fresh authorization. S3 keys are not client-selectable and no public URLs are issued.

### Omie

```json
{"unitId":"<authorized-business-unit-uuid>"}
```

### Protheus

```json
{"units":{"SP-Capital":"<authorized-business-unit-uuid>"}}
```

An empty object is also accepted. Unmapped `unidade` values are matched by exact,
trimmed name against `finance.business_unit`. Missing units are registered at
confirmation and only the registering member receives the new `finance.member_unit`
scope. An existing inaccessible name causes a conflict, never a scope grant.
Explicit mappings override name matching. At most 1,000 distinct units per file.

Technical admins can register units using `POST /business-units` with
`{"name":"SP-Capital"}`. Protheus auto-registration requires AR draft permission.
No financial role is granted by registration. Unit creation and access grants are
audited by existing database triggers.

### Itaú

```json
{"unitId":"<unit-uuid>","accountId":"<authorized-bank-account-uuid>"}
```

The selected existing account must belong to the selected unit and currency.
Credits and debits remain separate bank evidence. No reconciliation or settlement
is inferred from an amount, name, or document match.

### Manual CSV/XLSX

```json
{
  "unitId":"<unit-uuid>",
  "columns":{
    "party_name":"Customer",
    "party_tax_id":"CNPJ",
    "document_ref":"Invoice",
    "due_on":"Due date",
    "amount":"Value"
  },
  "dateFormat":"dd/MM/uuuu",
  "decimal":",",
  "currency":"BRL"
}
```

Column mappings use **target field → source header**. Titles require `party_name`,
`due_on`, `amount`; bank rows require `booking_date`, `description`, `direction`,
`amount`. Optional fields are reported by `targetFields`. A mapped `unit` column
uses the explicit `units` dictionary; automatic registration is Protheus-only.
Supported date formats are strict `dd/MM/uuuu` and `uuuu-MM-dd`, decimal separators
`,` or `.`, and currencies BRL/USD/EUR (two decimal places). Defaults are BRL,
ISO dates and dot decimals for manual/Omie; Brazilian dates and decimals for
Protheus/Itaú. Bank direction accepts C/D or credit/debit.

## Evidence, recovery, and limits

- Files stream to temporary disk, then to a private, versioned ingestion bucket
  before staging. SHA-256, object version, uploader, mapping and row locations are
  persisted. Source rows preserve original cell arrays; their `record:N` locator
  identifies the CSV logical record or XLSX worksheet row in the original artifact.
- CSV supports UTF-8/BOM, comma/semicolon delimiters, quoted separators and multiline
  cells. XLSX uses SAX parsing, not a full in-memory workbook. Upload one worksheet
  per XLSX; formula caches are read without executing formulas.
- Limits: 100 MiB compressed/upload bytes, 100 columns, 16,384 characters per cell;
  XLSX parts up to 256 MiB and shared-string/style parts up to 16 MiB. Larger inputs
  should be split. These are explicit resource bounds, not silent truncation.
- A process crash after S3 persistence can be recovered with
  `POST /imports/{id}/prepare`. Staging resumes idempotently from the original
  version. If the original has not been recorded, upload again with a new key.
  Invalid files remain failed with their persisted original available for inspection.
- Row validation failures are recorded and do not block other rows. Infrastructure
  or database failures roll back the current processing batch; retry the request.
  Paid flags are rejected for review because the financial model represents
  settlement through evidence/allocation, not a `paid` title status.
- Separate uploads remain separate evidence. Cross-platform lookalikes are not
  silently deduplicated: the sample's Omie and Protheus customer names demonstrate
  why name/amount similarity is insufficient for merging financial records.
- RLS is ENABLED and FORCED on all three ingestion tables. File/job/row access is
  uploader-only and requires current draft permissions or full bank access plus
  **all** mapped unit/account scopes. Losing any scope hides the whole file.
  An AR-only user cannot download a mixed debit/credit statement through this API.

## Environments and verification

`INGESTION_BUCKET` selects the dedicated bucket; `INGESTION_ENDPOINT` is empty in
AWS and `http://floci:4566` in Compose. `s3-init` creates
`vantara-ingestion-local`, enables versioning, encryption and public-access blocking.
Terraform adds a separate private encrypted versioned bucket, TLS-only policy, and
runtime version-read/write permissions without deletion. Evidence versions have no
automatic expiration. No Terraform apply is needed for static checks.

Backend integration tests use PostgreSQL 17 and Floci Testcontainers, real HTTP and
Cognito tokens, sample data, row correction, retry recovery and a deterministic
10,001-row synthetic report. Direct runtime-role database tests exercise RLS denial.
Terraform mocked tests cover bucket privacy, versioning and retention.
