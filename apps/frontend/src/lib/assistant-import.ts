import { z } from "zod";

export const assistantImportSchema = z
  .object({
    unitId: z.uuid(),
    currency: z.enum(["BRL", "USD", "EUR"]),
    rows: z
      .array(
        z
          .object({
            sourceMessageNumber: z.number().int().min(1).max(40),
            party_name: z.string().trim().min(1).max(500),
            document_ref: z
              .string()
              .trim()
              .min(1)
              .max(200)
              .describe(
                "Document identifier only, without labels: NF 88231 becomes 88231; Nota fiscal 088231 becomes 088231. Preserve leading zeros and identifier characters exactly.",
              ),
            due_on: z.iso.date(),
            amount: z
              .string()
              .regex(/^\d{1,16}\.\d{2}$/)
              .refine((value) => /[1-9]/.test(value))
              .describe(
                "Original invoice face amount, not revised interest charges or an aggregate total.",
              ),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const assistantImportResultSchema = z.object({
  id: z.uuid(),
  state: z.string(),
  total: z.number(),
  processed: z.number(),
  rejected: z.number(),
});
