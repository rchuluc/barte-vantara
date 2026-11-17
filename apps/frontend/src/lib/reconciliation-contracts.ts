import { z } from "zod";

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nullableText = z.string().nullable();

export const bankSchema = z.object({
  id: z.uuid(),
  unit_id: z.uuid(),
  direction: z.enum(["credit", "debit"]),
  booking_date: z.string(),
  description: z.string(),
  external_ref: nullableText,
  amount_minor: money,
  unallocated_minor: money,
  currency: z.string(),
  can_propose: z.boolean(),
  can_review: z.boolean(),
});
export const titleSchema = z.object({
  id: z.uuid(),
  unit_id: z.uuid(),
  source_system: z.string(),
  direction: z.enum(["payable", "receivable"]).optional(),
  party_name: nullableText,
  party_tax_id: nullableText,
  document_ref: nullableText,
  external_id: nullableText,
  due_on: nullableText,
  currency: z.string(),
  original_amount_minor: money,
  outstanding_minor: money,
  status: z.string(),
  observation_state: z.string(),
});
const historySchema = z.object({
  id: z.uuid(),
  actor_id: z.uuid(),
  created_at: z.string(),
  rationale: z.string(),
  origin: z.enum(["human", "ai", "rule"]).optional(),
  disposition: z.enum(["draft", "pending", "rejected_suggestion"]),
  review: z.enum(["confirmed", "rejected"]).nullable(),
  reviewer_id: z.uuid().nullable(),
  reviewed_at: nullableText,
});
export const reconciliationSchema = z.object({
  actorId: z.uuid(),
  banks: z.array(bankSchema),
  titles: z.array(titleSchema),
  decisions: z.array(
    historySchema.extend({
      bank_entry_id: z.uuid(),
      rejected_title_id: z.uuid().nullable(),
    }),
  ),
  allocations: z.array(
    z.object({
      decision_id: z.uuid(),
      title_id: z.uuid(),
      amount_minor: money,
    }),
  ),
  candidates: z.array(
    z.object({
      bankId: z.uuid(),
      titleId: z.uuid(),
      evidence: z.array(z.string()),
    }),
  ),
});
export const matchInputSchema = z.object({
  id: z.uuid(),
  action: z.enum(["draft", "pending", "rejected_suggestion"]),
  allocations: z
    .array(
      z.object({ titleId: z.uuid(), amountMinor: money.refine((v) => v > 0) }),
    )
    .max(100)
    .default([]),
  rejectedTitleId: z.uuid().optional(),
});
export const matchReviewSchema = z.object({
  decision: z.enum(["confirmed", "rejected"]),
});
export const matchResultSchema = z.object({ id: z.uuid() });
export const decisionSearchSchema = z.array(
  historySchema.extend({
    bank_entry_id: z.uuid(),
    approval_status: z.enum(["pending", "confirmed", "rejected"]),
    allocations: z.array(z.object({ title_id: z.uuid(), amount_minor: money })),
  }),
);
export const reconciliationDetailSchema = z.object({
  normalized: z.record(z.string(), z.unknown()),
  source: z.object({
    locator: z.string(),
    raw_text: z.string(),
    object_ref: z.string(),
    source_version: z.string(),
    ingestion_id: z.uuid().nullable(),
    filename: nullableText,
  }),
  history: z.array(historySchema),
});

export type Reconciliation = z.infer<typeof reconciliationSchema>;
export type BankCredit = z.infer<typeof bankSchema>;
export type Receivable = z.infer<typeof titleSchema>;
export type MatchInput = z.infer<typeof matchInputSchema>;

export const brl = (minor: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(
    minor / 100,
  );
export const dateBR = (date: string | null) =>
  date ? date.slice(0, 10).split("-").reverse().join("/") : "Não informado";

export function parseAllocation(value: string): number {
  if (!/^\d+(?:[,.]\d{0,2})?$/.test(value)) return NaN;
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : NaN;
}

export function overlaps(title: Receivable, titles: Receivable[]) {
  const tax = title.party_tax_id?.replace(/\D/g, "");
  return titles.some(
    (other) =>
      other.id !== title.id &&
      other.source_system !== title.source_system &&
      other.original_amount_minor === title.original_amount_minor &&
      other.currency === title.currency &&
      ((tax && tax === other.party_tax_id?.replace(/\D/g, "")) ||
        (title.document_ref && title.document_ref === other.document_ref)),
  );
}
