# Reconciliation flow verification — 2026-11-18

## Result and scope

| Flow | Result | Evidence type |
| --- | --- | --- |
| Original Itaú import → UI proposal → API human review | Passed | Live local API responses and browser observations |
| Statement and receivable UI imports → UI proposal → independent UI review → reload | Passed | Live browser accessibility snapshots |
| MCP discovery and initialization | Blocked: HTTP 503 | Live HTTP responses captured below |
| MCP import → proposal → UI review | Not executed | Endpoint unavailable; statement/receivable import tools also absent |
| MCP adapter and assistant-import automated checks | Passed: 40 tests | Fresh Vitest execution below; not live end-to-end evidence |

Environment: `http://vantara.localhost:3000`, local Docker services, PostgreSQL,
Floci, frontend and backend. No external Itaú, Protheus, or Omie writes occurred.
All amounts below are BRL. Code changes remain uncommitted.

The earlier live observations below are transcribed from this session's tool
results. Browser screenshots and raw HTTP artifacts for those earlier runs were
not saved; this report does not claim otherwise. Credentials and tokens are omitted.

## 1. Original Itaú statement: API import and mixed-channel reconciliation

Source: `data_pack/03_extrato_bancario_jul2026.csv`.

- Import: `ffdf3c0e-735e-48c5-bf78-2def6c81dd57`.
- Account: `c5e9d74e-332f-4030-8889-fbc72774442f` (`123 · Itau · BRL`).
- Destinations: MG, RJ, SP-Capital, SP-Interior, SUL.
- Result: 18 processed, 0 rejected, 18 bank movements.
- Sum of absolute movement amounts: `33603750` minor units (R$336,037.50).
  This is a file-total check, not an account balance or net cash flow.
- Every movement returned five `statement_unit_ids`; amounts were not multiplied
  by the number of BUs.

The reconciliation user selected the R$18,450 receipt and `NF 104521` through the
UI and saved a draft. The review was performed through the API after a browser
password-manager popup blocked the first reviewer attempt.

| Item | Identifier/result |
| --- | --- |
| Bank movement | `b35bcadb-7af4-4bca-afa4-95681367862f` |
| External reference | `000012345678` |
| Receivable | `7e890466-2c38-4114-81dd-be6d5c684130` |
| Document | `NF 104521` |
| Decision | `5e5319a4-3709-4247-ab30-4fda74c43b54` |
| Proposer | `reconciliation@vantara.com.br` |
| Reviewer | `controllership@vantara.com.br` |
| Self-review request | HTTP 403 |
| Independent review | `confirmed` |
| Bank remaining balance | `0` minor units |
| Title outstanding balance | `0` minor units |

This run alone was **not** an all-UI verification.

## 2. Complete browser-only walkthrough

Synthetic test reference: `UI-E2E-20261118`; amount: R$12.34.
The test added one bank movement and one receivable, avoiding a second import of
the original Itaú statement. These labeled records remain in the local database.

### Reproducible input files

`ui-flow-statement.csv`:

```csv
data;historico;documento;valor;tipo
18/11/2026;TESTE UI CONCILIACAO;UI-E2E-20261118;12,34;C
```

`ui-flow-receivable.csv`:

```csv
Customer,Amount,Due,Reference
TESTE UI CONCILIACAO,12.34,2026-11-18,UI-E2E-20261118
```

### Actions and observations

| Step | Browser action | Observed evidence |
| --- | --- | --- |
| 1 | Sign in as reconciliation; open Data imports → New import | Statement preview detected `Bank statements · itau` |
| 2 | Upload statement; open BU picker | MG, RJ, SP-Capital, SP-Interior, SUL each appeared as an option with a visible checkbox |
| 3 | Check all five BUs | ARIA snapshot showed all five options and checkboxes `[checked]` |
| 4 | Select `123 · Itau · BRL`; confirm import | `1 of 1 records processed · 100%`; `Processing complete All records were accepted. Your imported data is ready.` |
| 5 | Sign in as AR; preview receivable | `Receivables · custom`; map Customer → party name, Reference → document ref and external id, Due → due on, Amount → amount |
| 6 | Select SP-Capital and confirm import | One accepted record, zero rejected; receivable ID `55fd8243-8067-4276-af34-88a24410d77b` |
| 7 | Sign in as reconciliation; open Sugeridas; search reference | `TESTE UI CONCILIACAO` bank movement and matching receivable displayed |
| 8 | Select matching receivable; inspect bank source details | Original CSV source visible; allocation preserved after closing details |
| 9 | Save R$12.34 draft | `Rascunho salvo. Um revisor independente poderá confirmar.` |
| 10 | Inspect proposer controls | `Você propôs este rascunho. A confirmação exige outro revisor autorizado.`; Confirmar conciliação disabled |
| 11 | Sign in as controllership; select saved draft | Confirmar conciliação enabled for the separate reviewer |
| 12 | Open confirmation dialog | `Confirmar estas alocações?`; matching reference, R$12.34 allocation, projected title balance R$0.00 |
| 13 | Click Confirmar e registrar | `Conciliação confirmada e registrada no histórico desta aplicação.` |
| 14 | Reload page; select Confirmadas; search reference | Exactly one matching bank row remained under Confirmadas |
| 15 | Select movement and search title | Receivable row showed original R$12.34 and outstanding R$0.00; allocation checkbox disabled |
| 16 | Reopen bank details after reload | `unallocated_minor: 0`; original amount `1234`; persisted independent confirmation history |

Password-manager popups interrupted login transitions. The user dismissed them
through browser handoff; all financial actions in this run remained UI actions.

### Persisted source and audit evidence

- Bank ID: `110d2b42-2b5d-488f-a997-b6b12d6d6317`.
- Bank source ID: `fa0a8c22-40df-47b8-8f73-48ac12cce6d2`.
- Source locator: `record:2`.
- Source version: `0e5862a2-4464-4795-a6f6-cccfcea6fdbb`.
- Original source displayed:
  `["18/11/2026", "TESTE UI CONCILIACAO", "UI-E2E-20261118", "12,34", "C"]`.
- Proposal history: `Alocação proposta na bancada`.
- Author: `cff492ca-9f28-4c17-87c2-24d5fb83e326`, displayed time
  `18/11/2026, 10:36:39`.
- Review: `Confirmada`, reviewer `a45828ed-e44f-452f-af1b-c75dcbb3a42a`,
  displayed time `18/11/2026, 10:40:56`.
- Proposer and reviewer IDs differ. Both zero balances and history were inspected
  after a full page reload, not only immediately after clicking confirm.

## 3. Live MCP attempt

No Vantara MCP integration was available in this session's tool catalog. Direct
HTTP discovery and protocol initialization were attempted against the same local
workspace. Neither operation reached authenticated tool discovery.

### Protected-resource discovery

```sh
curl -sS -i -H 'Host: vantara.localhost:3000' \
  http://127.0.0.1:3000/.well-known/oauth-protected-resource/api/mcp
```

Observed response (2026-11-18 13:47:57 GMT):

```http
HTTP/1.1 503 Service Unavailable
cache-control: no-store
content-type: application/json

{"message":"The service is temporarily unavailable. Please try again."}
```

### MCP initialization

```sh
curl -sS -i -H 'Host: vantara.localhost:3000' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"vantara-flow-verification","version":"1.0.0"}}}' \
  http://127.0.0.1:3000/api/mcp
```

Observed response (2026-11-18 13:48:16 GMT):

```http
HTTP/1.1 503 Service Unavailable
cache-control: no-store
content-type: application/json

{"message":"The service is temporarily unavailable. Please try again."}
```

### Blockers and supported surface

`apps/frontend/src/services/mcp-auth.ts` requires an HTTPS Cognito issuer, a
dedicated MCP client ID, and a signed delegated access token bound to the exact
workspace MCP resource. Browser cookies and normal web-login tokens are not MCP
credentials. The 503 response does not by itself identify which configuration
value is missing or invalid.

The existing [MCP setup documentation](mcp-imports.md) explicitly states that
Floci 2.3.0 cannot issue the required OAuth resource-bound token and that there is
no local authentication bypass. No bypass or fabricated token was used here.

Source inspection of `apps/frontend/src/services/mcp.ts` found:

- Search/details tools and `proposeReconciliation` are implemented.
- `proposeReconciliation` returns `approvalStatus: pending`; it does not settle
  balances. No MCP approval tool is registered.
- `createImport` supports text-to-payables only, with one `unitId`.
- Statement CSV import with multiple `unitIds` and receivable import are not
  exposed as MCP tools. This was established by source inspection, not successful
  live `tools/list` discovery.

Consequently, the requested identical import-to-review scenario cannot currently
run entirely through MCP before UI approval. No new MCP proposal or approval was
created during this attempt.

### Automated adapter verification (fresh run)

```sh
cd apps/frontend
npx vitest run tests/mcp.test.ts tests/assistant-import.test.ts
```

```text
RUN  v4.1.12
Test Files  2 passed (2)
     Tests  40 passed (40)
  Start at  10:48:23
  Duration  421ms
```

These tests exercise adapter behavior with test keys and mocked backend responses.
They are not evidence that live Cognito authentication, persistence, and UI review
worked together through MCP.

## 4. Earlier implementation checks

The earlier implementation phase completed:

- Backend `./gradlew check`, including PostgreSQL integration tests and 95%
  coverage gates.
- Frontend formatting, lint, typecheck, 348 tests, coverage gates, production build.
- Trivy HIGH/CRITICAL scans: no findings for either local image.
- Dive: both images passed all three configured checks.
- Local V14 migration and healthy service startup on port 3000.

Relevant behavior coverage includes selected statement scope, scoped user access,
independent review, out-of-scope title rejection, and a global bank balance even
when some allocations are hidden from a narrowly scoped user. These are automated
checks; the browser walkthrough above exercises one full-settlement receivable
scenario, not every partial/grouped/debit/error combination.

## 5. Remaining live MCP verification

1. Supply a configured Cognito-backed workspace URL and connect the user's
   delegated MCP identity using the documented OAuth flow.
2. For reconciliation of already imported records: discover tools, get identity,
   list BUs/imports/bank entries/titles, inspect source evidence, find candidates,
   and create an AI proposal with a fresh UUID.
3. Record returned IDs, tool responses, pending review state, and unchanged
   pre-approval balances. Save sanitized evidence without bearer tokens.
4. Sign in as a different authorized human through the UI; inspect and confirm
   that exact proposal. Reload and capture audit history and balances.
5. Read the confirmed decision and balances back through MCP.
6. To include the original statement/receivable **import** steps in MCP, first
   implement those missing tools with multi-BU statement support and tests.

Do not re-import the original Itaú file or reapprove the completed test movement
to repeat the test. Use a new labeled fixture or an explicitly selected open
record, and record its provenance.
