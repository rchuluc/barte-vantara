import { z } from "zod";

export const tenantSchema = z
  .object({
    id: z.uuid(),
    slug: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
    name: z.string().trim().min(1).max(100),
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    domains: z
      .array(
        z
          .string()
          .max(253)
          .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
      )
      .min(1)
      .max(20),
  })
  .strict();

export type Tenant = z.infer<typeof tenantSchema>;
