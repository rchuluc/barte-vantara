import { z } from "zod";

export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const datasetSchema = z.enum(["receivable", "payable", "bank"]);
export const datasetLabels = {
  receivable: "Receivables",
  payable: "Payables",
  bank: "Bank statements",
};
export const importSummarySchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  dataset_kind: datasetSchema,
  platform: z.string().nullable(),
  state: z.enum(["uploading", "mapping", "processing", "completed", "failed"]),
  total: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  created_at: z.string(),
});
export const importSchema = importSummarySchema.extend({
  headers: z.array(z.string()),
  suggestedColumns: z.record(z.string(), z.string()),
  targetFields: z.array(z.string()),
});
export const importRowSchema = z.object({
  row_number: z.number().int().positive(),
  cells: z.array(z.string()),
  corrected_cells: z.array(z.string()).nullable(),
  state: z.enum(["pending", "accepted", "rejected"]),
  error: z.string().nullable(),
  result_id: z.uuid().nullable(),
});
export const unitsSchema = z.array(
  z.object({ id: z.uuid(), name: z.string() }),
);
export const importPreviewSchema = importSchema.extend({
  rows: z.array(importRowSchema).max(20),
});
export type ImportDraft = {
  file: File;
  preview: z.infer<typeof importPreviewSchema>;
  confirmed: boolean;
};
export const mappingSchema = z
  .object({
    columns: z.record(z.string(), z.string().min(1)),
    unitId: z.uuid().optional(),
    units: z.record(z.string(), z.uuid()).optional(),
    accountId: z.uuid().optional(),
    dateFormat: z.enum(["dd/MM/uuuu", "uuuu-MM-dd"]),
    decimal: z.enum([",", "."]),
    currency: z.enum(["BRL", "USD", "EUR"]),
  })
  .strict();
export type ImportJob = z.infer<typeof importSchema>;
export type ImportRow = z.infer<typeof importRowSchema>;
export type ImportMapping = z.infer<typeof mappingSchema>;
export type Dataset = z.infer<typeof datasetSchema>;

export function importPermission(kind: Dataset) {
  return kind === "bank" ? "bank" : `draft_${kind}`;
}
