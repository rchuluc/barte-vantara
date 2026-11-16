import type { ImportJob, ImportRow } from "@/lib/import-contracts";
import { member } from "./fixtures";

export const importId = "33333333-3333-4333-8333-333333333333";
export const unitId = "44444444-4444-4444-8444-444444444444";
export const importer = {
  ...member,
  permissions: ["draft_receivable", "draft_payable", "bank"],
};
export const job: ImportJob = {
  id: importId,
  filename: "receivables.csv",
  dataset_kind: "receivable",
  platform: "custom",
  state: "mapping",
  total: 1,
  processed: 0,
  rejected: 0,
  created_at: "2026-11-15T12:00:00Z",
  headers: ["Customer", "Amount", "Due date"],
  suggestedColumns: {
    party_name: "Customer",
    amount: "Amount",
    due_on: "Due date",
  },
  targetFields: ["party_name", "amount", "due_on", "unit"],
};
export const sourceRow: ImportRow = {
  row_number: 2,
  cells: ["Acme", "12.50", "2026-12-01"],
  corrected_cells: null,
  state: "pending",
  error: null,
  result_id: null,
};
export const mapping = {
  columns: job.suggestedColumns,
  unitId,
  dateFormat: "uuuu-MM-dd" as const,
  decimal: "." as const,
  currency: "BRL" as const,
};
