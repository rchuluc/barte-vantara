# AI import assistant: accounts-payable inbox test

## Source

Open **Imports → Ask Vantara** and attach
[`data_pack/04_caixa_de_entrada_contas_a_pagar.txt`](../../data_pack/04_caixa_de_entrada_contas_a_pagar.txt).
Send: `Analise esta caixa de entrada e me ajude a importar os dados.`

Before confirmation, no import or payable should be saved. The assistant should
identify the invoice, the collection follow-up, the freight aggregate, and the
unverified WhatsApp claims. Its wording and question order may vary.

## Clarifications for a deterministic test

Reply with the following, then choose an actual business unit returned by the
assistant. These are **explicit test choices**, not facts inferred from the file:

```text
Quero importar somente a NF 88231 do E-MAIL 1.
Fornecedor: Sao Jorge Embalagens.
Confirmo o vencimento completo: 20/07/2026.
Use o valor original de R$ 18.900,00, em BRL.
Para este teste, considere o E-MAIL 2 uma cobrança da mesma dívida:
não crie outro título para 088231 e não aplique os juros.
Não importe o PC 4471, os fretes nem as mensagens de WhatsApp como títulos.
Não marque nada como pago ou aprovado.
Mostre a revisão para eu confirmar a importação.
```

The review should show exactly **one payable**, its supplier, document, amount,
currency, due date, and chosen business unit. Click **Confirm import**.

## Expected persisted data

| Payable field                              | Expected value            |
| ------------------------------------------ | ------------------------- |
| `direction`                                | `payable`                 |
| `party_name`                               | `Sao Jorge Embalagens`    |
| `document_ref`                             | `88231`                   |
| `due_on`                                   | `2026-07-20`              |
| `currency`                                 | `BRL`                     |
| `original_amount_minor`                    | `1890000`                 |
| `current_amount_minor`                     | `1890000`                 |
| `status`                                   | `open`                    |
| `unit_id`                                  | Chosen business unit UUID |
| `issued_on`, `party_tax_id`, `external_id` | `null`                    |

Generated IDs and timestamps vary. Import history should show
`assistant-import.csv`, dataset `payable`, platform `custom`, state `completed`,
`total=1`, `processed=1`, and `rejected=0`. **Review import** opens its detail page.
The generated CSV and source record retain the complete original user source in
bounded `source_1` through `source_8` cells, with `source_type=agent_unstructured`.

The original and current amounts initially match: this flow creates open titles;
it does not apply collection interest or reconcile existing debt. The updated
R$ 19.278,00 and contradictory claims remain in the original source for review.

## What must not happen

- No automatic save immediately after parsing or after a conversational “yes”.
- No second debt from `088231`, given the explicit clarification above.
- No payable from purchase order `PC 4471` or an attachment filename.
- No 46 fabricated CT-e rows or invented freight due date from the aggregate
  R$ 34.117,82. The actual spreadsheet and receipt date are absent.
- No payment, approval, or settlement inferred from WhatsApp.
- **Cancel import** saves nothing. **Retry import** after a failed save reuses the
  same import key; it must not duplicate accepted rows.

Use a fresh test source/proposal for the cancel case. Starting a new chat and
confirming another proposal is a new import, not cross-conversation deduplication.
