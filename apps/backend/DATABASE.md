# Financial database foundation

PostgreSQL 17, existing Flyway migrations V2–V5, existing JDBC/Testcontainers stack.
An operational model, **not a general ledger or full ISO 20022 implementation**.
No sample financial data or sample approvals are installed by migrations.

## Model and ingestion contract v1

Every format uses the same envelope:

| Contract field                        | Storage                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tenant and authorized processing unit | `import_batch.tenant_id`, `unit_id`                                                                        |
| Origin                                | `source_system`, `dataset_kind` (payable, receivable, bank)                                                |
| Original artifact                     | `object_ref` plus immutable `source_version` (object version or content digest)                            |
| Contract version                      | `contract_version = 1`                                                                                     |
| Location                              | `source_record.locator`: original line number, message ID, attachment/page locator                         |
| Faithful original evidence            | Immutable `source_record.raw_text`; never overwrite with parsed values                                     |
| Processing state/output/exceptions    | Append-only `source_review`; `source_processing` shows latest state, interpretation, unresolved exceptions |
| Normalized entity                     | Typed `title`, `bank_entry`, `bank_balance`, or `payable_evidence`, each referencing its source            |

Initial processing state is `received`. Subsequent states are `parsed`, `needs_review`,
`rejected`, or human `verified`. Interpretation is versioned JSON evidence, not an
approval or settlement. Record unresolved ambiguity in `exceptions`; a new review
records resolution without modifying earlier evidence. Money in interpretations
uses `{amount_minor, currency}`; unknown observations stay absent/null. Raw text
retains original decimal separators, dates, names and instructions unchanged.
The adapter does not parse any format or fetch any artifact.

Idempotency: batch key = tenant + unit + source system + artifact reference +
immutable version; record key = tenant + batch + locator. A changed artifact
requires a new version. The repository returns the existing ID on an identical
retry and rejects different raw evidence/classification under an existing key.
The normalization key permits several titles from one source record without
duplicating the same normalized output. Document numbers, names, amounts and tax
IDs are **not** deduplication keys. Re-exported files with different versions
remain separate observations until reviewed.

Batch metadata is partitioned by authorized unit/dataset even when several batches
reference the same physical artifact. Category is an access classification supplied
by trusted routing, not an AI conclusion: payable, receivable, bank debit/general,
or incoming bank credit. Missing unit/routing requires a deliberately provisioned,
restricted intake unit; do not guess a business-unit assignment. Artifact references
are metadata, not download authorization; future artifact retrieval must enforce
record-level permissions, including mixed-access files.

### Expected items, posted movements, suggestions

- `title`: separate payable/receivable obligations; nullable party and dates, source
  external identifiers/document references, currency, original and current **face**
  amounts, expected/suggested observation state, open/disputed/cancelled status.
  Current face amount is not outstanding balance. Updates retain original source
  and original amount, require a latest source link, and are audited.
- `bank_account` and immutable `bank_entry`: posted movements, account, explicit
  credit/debit, booking date, optional value date/counterparty/references. No match
  is implied by a reference or name.
- `reconciliation_decision` + `allocation`: immutable proposals with human/AI/rule
  origin; many-to-many entry/title links. `reconciliation_review` separately confirms
  or rejects. Conflicting proposals may coexist. Confirmation checks currency,
  direction, expected/open title state and total available amounts. No FX inference.
- `title_position.outstanding_minor` = current face amount minus confirmed
  allocations. `bank_position.unallocated_minor` exposes unmatched credit/debit
  residuals (including potential overpayments). Unconfirmed allocations change neither.
- `payable_evidence` preserves extraction/possible-duplicate claims.
  `payable_submission` snapshots a title; a different, explicitly authorized human
  may insert one `payable_review`. A changed snapshot cannot be approved. Historical
  approval applies only to that snapshot, not subsequent edits. No payment is executed.
- `collection_case`, `close_exception`, `forecast`: small scoped operational records.
  `financial_summary` contains typed aggregate amounts only; FP&A sees it only after
  independent `summary_publication`. Publication is explicit, not an automatic sum
  that could reveal raw records through a view.

### ISO vocabulary and money

| camt.053 concept                                   | Local model                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Acct/Id`, `Acct/Ccy`, account servicer            | `bank_account.account_ref`, `currency`, `bank_code`                               |
| `Ntry/Amt`, `CdtDbtInd`                            | `bank_entry.amount_minor` with currency; `credit` = CRDT, `debit` = DBIT          |
| `Ntry/Sts` BOOK                                    | `bank_entry.observation_state = posted`                                           |
| `BookgDt`, `ValDt`                                 | `booking_date`, nullable `value_date`; never invoice due date                     |
| `NtryRef`, `AcctSvcrRef`, `TxDtls/Refs/EndToEndId` | `external_ref`, `account_servicer_ref`, `end_to_end_ref`                          |
| `Bal/Tp`, `Bal/Dt`, `Bal/Amt`, `Bal/CdtDbtInd`     | Sourced `bank_balance` snapshots with balance type, date, minor amount, direction |

All persisted monetary columns are **bigint minor units** with a foreign key to
the ISO 4217 currency reference. BRL 18,900.00 = 1,890,000; JPY has 0 decimal places,
KWD 3, CLF 4. The initial reviewed subset is BRL/USD/EUR/JPY/KWD/CLF. Unsupported
codes require a migration; do not assume two decimals or accept arbitrary three-letter
strings. Future normalization must multiply exact decimal source values by
10^minor_unit, reject fractional minor units/overflow, and never silently round.

Amounts are magnitudes with separate direction. PostgreSQL exact `numeric` SUM
results in views are still integer minor-unit totals (no fractional money storage).
Bank balances are source-provided snapshots only. The pack supplies **no balance**,
so fixtures install none. Invoice issue/due dates, ingestion timestamps and bank
booking/value dates remain distinct. Dates are `date`; event times are `timestamptz`.
Full timestamp-choice camt fields, XML validation, FX, reversals and general-ledger
postings are outside this foundation. Receivables, AP messages, approvals, collection
cases and forecasts are operational concepts outside a bank statement.

References: [ISO bank-to-customer message definitions](https://www.iso20022.org/sites/default/files/2020-12/ISO20022_MDRPart2_BankToCustomerCashManagement_2020_2021_v1_ForSEGReview.pdf),
[SIX ISO 4217 List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml)
(reference subset from 2026-01-01).

## Authorization and trust boundary

Membership binds **text issuer + text subject** to a tenant, active status, roles,
principal kind and explicit units. There are no passwords or authorization-by-email.
Scopes apply to every financial record; being an admin of A grants nothing in B.

| Role                      | Default access within assigned units                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| AP (`ap`)                 | Payables, their source/evidence, preparation and submission                                            |
| AR/Collections (`ar`)     | Receivables, incoming bank evidence, collection cases                                                  |
| Reconciliation            | Payables, receivables, bank evidence and match proposals                                               |
| Controllership            | Cross-functional financial evidence, reconciliation, close exceptions, draft summaries                 |
| FP&A (`fpa`)              | Published aggregate summaries and forecasts; no raw messages, supplier instructions or bank details    |
| Technical Admin (`admin`) | Tenant membership/role/unit configuration, integration and import metadata, operational audit metadata |

`approval_scope` separately grants `approve_payable`, `review_reconciliation`, or
`publish_summary` per unit. None of the six roles implies these permissions. The
actor also needs the relevant financial role. Only the privileged authorization
provisioner (migration owner initially) can grant approval scopes; tenant admin
cannot grant them, rebind existing identities, or change principal kind. Admin
can explicitly assign financial roles, including to themselves; these changes
are audited. Removing that administrative ability is a future governance decision.

AI principals and AI-mediated requests cannot make human approvals. A human may
independently review an AI proposal; its AI origin remains immutable. The trusted
service must mark AI-mediated calls `ai`, including those delegated by a human.
Approval actions require a dedicated human interaction, not an AI-tool argument.

### Exact future service contract (API and MCP use the same path)

1. Verify Cognito JWT signature using RS256 and the trusted issuer's JWKS; reject
   unapproved algorithms/issuers, unknown keys after bounded refresh, expired tokens,
   invalid time claims, or `token_use` other than `access`. Never use a token-supplied
   URL as a JWKS trust source. Require nonempty text `iss` and `sub`.
2. Require the configured allowlisted **`client_id`**. For this foundation's future
   API/MCP contract, also require resource-bound **`aud`** exactly equal to the
   configured API resource URI and the endpoint's required OAuth scopes. Reject a
   missing/wrong audience; an ID token's audience is not a substitute. Configure
   Cognito managed-login resource binding when implementing authentication.
3. MCP setup uses per-user OIDC authorization-code login with PKCE/state/nonce
   validation. Each later request must carry/resolve that individual's verified
   access token. No shared connector identity, M2M grant, or connector-wide tenant access.
4. The requested tenant is only a selector. Begin a READ COMMITTED transaction,
   set the four verified values below with parameter binding, then resolve active
   membership from the database. Reject if absent. Roles/unit/approval permissions
   come from database rows, never request fields, Cognito groups, or AI assertions.
5. Execute parameterized repository operations; commit or roll back; release the
   connection. Always set every context field on every transaction. Never use
   persistent `SET`, reuse a context between requests, or expose arbitrary SQL.

```sql
BEGIN;
SELECT set_config('app.issuer', :verified_issuer, true),
       set_config('app.subject', :verified_subject, true),
       set_config('app.tenant', :selected_tenant_uuid_text, true),
       set_config('app.actor_kind', :trusted_human_or_ai, true);
SELECT finance.actor(:selected_tenant_uuid); -- must be non-null
-- parameterized work
COMMIT;
```

**RLS does not verify Cognito tokens.** PostgreSQL settings are editable by anyone
who can execute SQL as the runtime account. The trusted service is responsible
for token validation, actor classification, parameter binding and preventing
untrusted SQL execution. `VerifiedFinanceContext` is a contract, not a verifier.
Revocation-before-expiry and session lifetime policy remain authentication work.
See [AWS token validation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
and [resource binding](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html#cognito-user-pools-resource-binding).

### Database enforcement

Every table ENABLEs/FORCEs RLS, including global read-only currency/role references
and Flyway history. Missing/malformed/inactive tenant identity fails closed.
`app_user` owns no tables, has no superuser/BYPASSRLS/role-management rights and
cannot become `finance_guard`. Tenant-aware foreign keys prevent cross-tenant links;
source/title/bank relationships also bind unit. Financial evidence, proposals,
reviews and audits have no runtime UPDATE/DELETE policies or grants. Mutable title
fields and integration metadata have column grants and checked update policies.

The NOLOGIN `finance_guard` owns narrowly scoped, fixed-search-path definer
functions: membership predicates, validated workflow triggers, audit insertion,
and authorized scalar settlement totals. It has explicit read policies, not
BYPASSRLS; the runtime cannot call trigger functions directly or inherit the role.
Every returned identity/total is checked against the selected tenant and scope.
Views use `security_invoker`. Audit detail follows financial category/unit access;
admin's separate audit metadata contains no raw values. FK/unique checks still
run outside RLS; services must return generic conflicts, not raw database errors.

Confirmations and title amount changes serialize per tenant with transaction locks.
Confirmation requires READ COMMITTED, positive same-currency allocations, and
independent reviewers. A confirmed proposal cannot receive more allocations.
Concurrent conflicts/deadlocks must roll back and be retried as whole transactions.

## Repository boundary

`finance/FinanceRepository.kt` contains framework/JDBC-free contracts and value
types. `FinanceStore` owns transaction lifetime; `FinanceRepository` currently
provides unified ingestion and scoped position reads. `finance/postgres` alone
knows SQL, connections and PostgreSQL settings. Add future persistence operations
to this boundary as needed; no generic CRUD layer or application services.
Replacing PostgreSQL requires a new adapter **and equivalent migrations/security
policies**, with the same behavioral tests—not just a connection-string change.

## Run and verify

From the repository root (local database/migration only):

```sh
docker compose up -d database
docker compose run --rm --build migrate
```

The existing migration profile uses a separate owner with database/schema ownership
and CREATEROLE; runtime Flyway remains off. V1 provisions `app_user` using
`APP_DB_PASSWORD` (ASCII alphanumeric). V2 grants the function-owner role only to
the migration owner. Keep migration credentials out of runtime services. Never
edit these migrations after deployment; make forward migrations instead.

```sh
cd apps/backend
export DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
./gradlew ktlintFormat
./gradlew check
```

JUnit/Testcontainers runs real PostgreSQL 17, Flyway, runtime-role SQL and repository
integration tests. Reports: `build/reports/tests/test/`, `build/reports/jacoco/test/`.
Focused run: `./gradlew test --tests '*FinancialDatabaseTests' --tests '*FinancialRepositoryTests'`.
See [database test results](database-test-results.md).

## Assumptions and deferred decisions

- Fixtures transcribe representative source rows manually. Their processing units,
  account identifiers, identities and approvals are **synthetic test setup**, not
  business facts inferred from the pack. Original unit names remain in raw evidence.
- Protheus/Omie Grao Nobre items remain separate; no automatic party merge or
  duplicate cancellation. Doce's grouped payment and Bela Vista's partial payment
  are tested hypotheses, not migrations that confirm the sample.
- Updated supplier bill and WhatsApp chronology are unresolved evidence. Interest,
  delivery, approval authenticity and payment identity need human investigation.
- Initial allocations require one scoped unit across the linked title and movement.
  Shared-account unit attribution, cross-unit clearing, FX, settlement reversals,
  voiding approvals and accounting adjustments need explicit business rules.
- Unit routing, full currency/historical currency coverage, artifact immutability
  enforcement, retention and aggregate publication policy need production decisions.
  No bank balances are reconstructed from this incomplete statement.
