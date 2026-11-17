# Conciliação de recebíveis

The workbench now also supports payable/debit reconciliation and AI-origin
proposals. See [agent searches and reconciliation](mcp-reconciliation.md) for
the expanded MCP workflow and the required V11 migration. All authorized bank
accounts and imported title sources are available, not just Itaú/Protheus/Omie.

The tenant workspace exposes `/reconciliation`. All records come from PostgreSQL
through the authenticated same-origin API; there is no seeded frontend dataset.

## Before opening the workbench

- Run Flyway migration `V10__receivables_workbench.sql` before the new backend.
- Complete the Itaú import as **bank**, with a provisioned bank account (code
  `341`) and authorized business unit. A file waiting for mapping is not a posted
  bank entry. The existing import screen remains the ingestion entry point.
- Protheus and Omie imports must be completed as **receivable**. Each source
  record remains distinct, including possible duplicates across systems.
- Operators require `propose_match` and access to the bank account and titles.
  Reviewers require `review_reconciliation` approval scope for the account's unit
  and every title unit. The original independent-review requirement remains:
  authors cannot confirm their own drafts, and delegated AI callers cannot review.

## API

| Method | Path under `/api/reconciliation` | Purpose |
| --- | --- | --- |
| GET | `/` | Authorized bank/title positions, proposals, allocations and evidence |
| GET | `/banks/{id}/details` | Original bank row, normalized fields and decision history |
| GET | `/titles/{id}/details` | Original title row, normalized fields and decision history |
| POST | `/{bankId}` | Append an immutable draft, pending decision or suggestion rejection |
| POST | `/decisions/{id}/review` | Confirm or reject the latest proposal independently |

Amounts use integer minor units. Writes run in the authenticated tenant
transaction, serialized with the existing tenant advisory lock. Confirmation
revalidates current bank/title balances, currency, title state, identity evidence
and authorization. Superseded proposals cannot be reviewed. Existing database
triggers independently enforce available balances and append audit records.

Drafts do not consume balances. Confirmed allocations do. A collection account
may receive payment for titles in other authorized units in the same tenant;
the title's original unit is preserved. No endpoint writes to external systems.

## Evidence and acceptance

Suggestions explain exact reference matches, normalized CNPJ matches, or name
tokens in the bank description. Date and amount coincidences are supplemental;
neither establishes identity. An unidentified deposit cannot be confirmed based
solely on amount equality. Overlap alerts require matching currency/amount and
identity or document across different sources; they never merge titles.

The PostgreSQL HTTP integration test imports the supplied files and exercises
Doce Ponto (4,278,050 + 485,000 centavos), Bela Vista (6,250,000 against a
12,500,000-centavo title), missing identity, cross-unit review authorization,
account revocation and immutable decisions. Frontend interaction tests cover
multiple allocations, partial balances, Grão Nobre overlap, details without
discarding edits, explicit confirmation, rejection and API failures.

Local readiness observed during implementation: 22 title records, no bank
accounts and no posted bank entries; two bank-file uploads were awaiting mapping
under the receivable dataset kind. These imports were not rewritten or deleted.
