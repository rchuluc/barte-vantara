import { z } from "zod";

export const businessUnitSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
});

export const bankAccountSchema = z.object({
  id: z.uuid(),
  unit_ids: z.array(z.uuid()),
  configurable: z.boolean(),
  bank_code: z.string(),
  account_ref: z.string(),
  currency: z.enum(["BRL", "USD", "EUR"]),
  active: z.boolean(),
});

export const createUnitSchema = z
  .object({ name: z.string().trim().min(1).max(200) })
  .strict();
export const updateUnitSchema = createUnitSchema.extend({
  active: z.boolean(),
});
export const updateAccountSchema = z
  .object({
    bankCode: z.string().trim().min(1).max(50),
    accountRef: z.string().trim().min(1).max(200),
    active: z.boolean(),
    unitIds: z.array(z.uuid()).min(1).max(100).optional(),
  })
  .strict();
export const createAccountSchema = updateAccountSchema
  .omit({ active: true })
  .extend({
    unitIds: z.array(z.uuid()).min(1).max(100),
    currency: z.enum(["BRL", "USD", "EUR"]),
  });

export type BusinessUnit = z.infer<typeof businessUnitSchema>;
export type BankAccount = z.infer<typeof bankAccountSchema>;
export type DestinationKind = "business-units" | "bank-accounts";
export const accountLabel = (account: BankAccount) =>
  `${account.bank_code} · ${account.account_ref} · ${account.currency}`;
