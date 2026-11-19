# Live MCP reconciliation evidence — 2026-11-18

## Outcome

**Test session closed at the user's request.** The user confirmed there is no
other reviewer account and accepted ending verification at the pending-proposal
stage. No further reviewer provisioning or approval is planned for this run.

Live MCP authentication, read operations, and AI proposal creation **passed**.
The statement was completed through the UI as authorized. UI approval remains
blocked by missing independent reviewer setup and missing recognized identity
evidence. Both monetary balances remain unchanged. The sections below preserve
the initial blockers and subsequent successful setup chronologically.

Related local evidence: [complete local walkthrough](reconciliation-flow-evidence-2026-11-18.md).
Application changes were pushed as `9ac8f61`; this MCP run does not establish which
commit is deployed. Responses below came from the connected `vantara` MCP server,
not mocks or direct backend API calls. Tokens were not collected.

## Tool discovery

The connected catalog exposed 12 tools:

`getIdentity`, `listBusinessUnits`, `listImports`, `getImport`,
`listBankEntries`, `listTitles`, `listReconciliations`, `getFinancialDetails`,
`findMatchCandidates`, `proposeReconciliation`, `extractEvidence`, `createImport`.

There is no bank-statement upload/mapping/processing tool, account-management tool,
or approval tool. `createImport` accepts payables only. Therefore the existing bank
import cannot be completed using the current MCP surface.

## Live calls and observed results

| Call | Result |
| --- | --- |
| `getIdentity()` | Active membership; delegated `actorKind: ai`; all six business roles; one BU, zero bank-account grants, zero approval scopes |
| `listBusinessUnits()` | One visible destination: `MCP Test` |
| `listBankEntries({state:"open",limit:100})` | `[]` |
| `listBankEntries({limit:100})` | `[]`, including settled entries |
| `listTitles({state:"open",limit:100})` | One open payable: São Jorge Embalagens, document `88231`, R$18,900.00 |
| `listImports({limit:100})` | One unprocessed bank import and one completed payable import |
| `listReconciliations({limit:100})` | `[]` |
| `getImport({id:"ae91c7a0-d351-47f3-b8df-33c3725321fd"})` | Itaú statement remains in `mapping`, 18 total, 0 processed, 0 rejected |
| `getImport({id:"d0d0c85b-6fdc-4362-a42e-5d10272bd41e"})` | Payable import `completed`, 1 total, 1 processed, 0 rejected |
| `getFinancialDetails({kind:"titles",id:"8e31c613-3acb-4502-addc-66fd5e1cfcb2"})` | Original email evidence, normalized payable, outstanding balance, and empty history returned |

All lists returned fewer than the requested 100 records; further pages were not
needed for these scoped results. Empty bank results establish only that this
identity sees no bank entries, not that no bank entries exist anywhere in the tenant.

### Identity and scope

```json
{
  "id": "fe428a25-27a5-47a1-8934-c88c09a146ec",
  "tenant_id": "30a1f18a-a44a-4424-a132-9c51795b4172",
  "display_name": "Administrator",
  "active": true,
  "principal_kind": "human",
  "actorKind": "ai",
  "roles": ["admin", "ap", "ar", "controllership", "fpa", "reconciliation"],
  "unitIds": ["c12094b3-183a-463c-b473-9b2e85e6ba89"],
  "bankAccountIds": [],
  "approvalScopes": []
}
```

`propose_match` is present in the returned effective permissions. Broad role names
do not supply the missing bank-account grants or independent-review scopes.

### Bank import evidence

```json
{
  "id": "ae91c7a0-d351-47f3-b8df-33c3725321fd",
  "filename": "03_extrato_bancario_jul2026.csv",
  "dataset_kind": "bank",
  "platform": "itau",
  "state": "mapping",
  "total": 18,
  "processed": 0,
  "rejected": 0,
  "created_at": "2026-11-17T19:13:25.000Z",
  "headers": ["data", "historico", "documento", "valor", "tipo"],
  "suggestedColumns": {
    "booking_date": "data",
    "description": "historico",
    "external_id": "documento",
    "amount": "valor",
    "direction": "tipo"
  }
}
```

### Existing payable and source evidence

```json
{
  "id": "8e31c613-3acb-4502-addc-66fd5e1cfcb2",
  "unit_id": "c12094b3-183a-463c-b473-9b2e85e6ba89",
  "source_system": "custom",
  "direction": "payable",
  "party_name": "São Jorge Embalagens",
  "document_ref": "88231",
  "due_on": "2026-07-20",
  "currency": "BRL",
  "original_amount_minor": 1890000,
  "outstanding_minor": 1890000,
  "status": "open",
  "observation_state": "expected"
}
```

The details response preserved the original email dated `06/07/2026 09:14`,
subject `NF 88231 - Vantara`, referencing invoice 88231, purchase order 4471,
R$18,900.00, and maturity 20/07. Personal contact and banking details are omitted
from this report. No payment or approval was inferred from that invoice evidence.

- Import: `d0d0c85b-6fdc-4362-a42e-5d10272bd41e` (`assistant-import.csv`).
- Source ID: `6ee871f2-5c40-4bb4-a8e1-6ed79646f65f`.
- Locator: `record:2`.
- Source version: `RuNwUAjRIqHa7cXZnDfmbHJZ2UkgnQzP`.
- History: `[]`.

## Remaining steps

1. Finish the pending statement import into the intended BU/account and grant the
   connected proposer access to that account. Current MCP tools cannot perform
   this setup. Using UI for setup would be an explicit exception to the requested
   MCP-only-before-approval workflow.
2. Identify a different human reviewer with reconciliation approval scope for the
   participating BU(s) and access to the account. The connected identity currently
   reports no approval scopes; other users' scopes were not inspected.
3. Through MCP, inspect a visible bank entry, find compatible candidates, compare
   original evidence, and create an AI-origin proposal only for a verified match.
4. Capture pending status and unchanged balances through MCP.
5. Approve that exact proposal through the separate reviewer's UI session, reload,
   then verify confirmed status, audit identities, and balances through MCP.

This run has not verified multi-BU behavior in production: only `MCP Test` is
visible to the connected identity. No invalid proposal with invented bank IDs was
submitted as a substitute for the missing end-to-end test.

## Authorized UI setup attempt

The user authorized completing statement/account setup through the UI. Opened
`https://vantara.wura.io/imports/ae91c7a0-d351-47f3-b8df-33c3725321fd`
in browser tab `498270278`. The live workspace required sign-in. Two sign-in
handoffs returned `continued`, but fresh snapshots still showed `Welcome back`,
Work email, Password, and Sign in. Navigating again to `/imports` also showed the
login screen. A successful authenticated browser session was not established.

No account, permission, import, proposal, or approval mutation was performed.
The browser tab is retained for the user to finish sign-in; setup remains blocked
on that step. MCP authentication remains separate from browser authentication.

On the user's requested retry, the earlier tab had been closed. A new tab
(`498270298`, connected browser `Chrome on Mac`) redirected the import URL to
`https://vantara.wura.io/login`. Another handoff returned `continued`, but the
subsequent snapshot and browser status still confirmed the login screen. No live
mutations were made during this retry. The new tab remains open for sign-in.

## Successful UI setup and live MCP proposal

After the user signed in, the browser showed the Administrator workspace.
The pending import's source rows and suggested Itaú mappings were inspected.
Only `MCP Test` was available; its bank-account picker had no accounts.

Created through the UI:

- Bank code: `341`.
- Account reference: `MCP Test - Itau fixture` (a test destination, not a verified
  real account number).
- Currency: BRL; BU: `MCP Test`.
- Resulting account ID, verified through MCP:
  `e1b11e55-af37-42ad-b952-150551f8cbd3`.

Selected that account and BU, kept DD/MM/YYYY and comma-decimal formatting, and
clicked `Confirm and import`. Subsequent live MCP `getImport` returned:

```json
{"id":"ae91c7a0-d351-47f3-b8df-33c3725321fd","state":"completed","total":18,"processed":18,"rejected":0}
```

MCP identity now included the new account ID; `actorKind` remained `ai` and
`approvalScopes` remained empty.

### Matching and original evidence

`listBankEntries({name:"88231",limit:100})` returned bank entry
`1270c43f-2d7b-482a-949e-7bf2eda597cc`: debit, booking date 2026-07-20,
`PAGAMENTO FORNECEDOR NF 88231`, amount and remaining balance `1890000`, BRL,
and statement scope containing only the `MCP Test` BU.

`getFinancialDetails` returned source locator `record:10`, version
`jryfxQqSeR1dS_FhGJKGYSDyC4CHMChl`, and this original row:

```json
["20/07/2026", "PAGAMENTO FORNECEDOR NF 88231", "", "18.900,00", "D"]
```

`findMatchCandidates` returned the existing São Jorge payable with:

```json
{"identityEvidence":[],"amountMatches":true,"dateDifferenceDays":0}
```

**Finding:** document `88231` appears in the bank description and invoice evidence,
but the current matcher does not recognize document references embedded in bank
descriptions. The bank's dedicated `external_ref` is null. Source inspection of
`MatchEvidence.identity` confirms it checks the dedicated reference, CNPJ, or
party-name words. The UI consequently reports identity unproven. No source fields
were altered to manufacture a recognized match.

### MCP write and read-back

No previous decision existed for this bank entry. Called:

```json
{
  "tool":"proposeReconciliation",
  "arguments":{
    "bankId":"1270c43f-2d7b-482a-949e-7bf2eda597cc",
    "id":"87b349d3-5b2c-4e29-a62b-02a0ace3ad71",
    "allocations":[{"titleId":"8e31c613-3acb-4502-addc-66fd5e1cfcb2","amountMinor":1890000}]
  }
}
```

Response:

```json
{"id":"87b349d3-5b2c-4e29-a62b-02a0ace3ad71","approvalStatus":"pending","reviewPath":"/vantara/reconciliation"}
```

Independent read-back using `listReconciliations`, `listBankEntries`, and
`listTitles` confirmed:

- `origin: ai`, `disposition: draft`, `approval_status: pending`.
- Rationale: `Proposta por agente; aguardando aprovação humana`.
- Created: `2026-11-18T18:19:06.330Z`.
- Actor: `fe428a25-27a5-47a1-8934-c88c09a146ec`.
- `review`, `reviewer_id`, and `reviewed_at`: null.
- Bank remaining: `1890000`; title outstanding: `1890000`.

The pending proposal is a review artifact, **not a confirmed match**. The projected
zero balance in the allocation summary is not the persisted outstanding balance.

### UI verification and remaining blockers

User management displayed only Administrator, the same underlying user as the
MCP proposer; self-edit was disabled. No separate reviewer was available in this
visible user list. No additional user was invited or invented.

In reconciliation → Sugeridas, searched `88231` and selected the movement. The UI
loaded the MCP allocation and showed:

- `Proposta por agente · aguardando aprovação humana`.
- `Você propôs este rascunho. A confirmação exige outro revisor autorizado.`
- `Identidade não comprovada` with explanation that equal amount alone is
  insufficient to confirm.
- `Confirmar conciliação` disabled.

Screenshot: [live proposal and approval blockers](live-mcp-2026-11-18/proposal-awaiting-review.png).

Approval and final settlement have **not** passed. Continuing requires an
independent reviewer account with appropriate scope, plus resolution of the
document-reference matching limitation (or another fixture with independently
verified, currently supported identity evidence). The statement and pending
proposal remain in the live test BU; no external bank/ERP write occurred.

## Final disposition

| Check | Final result |
| --- | --- |
| Live MCP authentication and scoped reads | Passed |
| Authorized UI account setup and statement import | Passed: 18 processed, 0 rejected |
| MCP AI proposal creation and persisted read-back | Passed |
| Proposal visible in UI with AI attribution | Passed |
| Proposal does not settle balances | Passed: both remain R$18,900.00 |
| Same-user confirmation blocked in UI | Passed: confirmation disabled |
| Independent UI approval and final settlement | Not executed: no other user exists |
| Recognition of invoice number inside bank description | Limitation recorded: identity evidence empty |

The final live decision is `87b349d3-5b2c-4e29-a62b-02a0ace3ad71`, still
**pending**, with no reviewer or review timestamp. No claim of successful
end-to-end live approval is made. The completed local UI approval flow is
documented separately and is not substituted for this unexecuted live step.
