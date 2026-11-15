import { z } from "zod";

export const userSchema = z.object({
  id: z.uuid(),
  tenant_id: z.uuid(),
  email: z.email(),
  display_name: z.string(),
  active: z.boolean(),
  principal_kind: z.string(),
  roles: z.array(z.string()),
  unitIds: z.array(z.uuid()),
  bankAccountIds: z.array(z.uuid()),
});

export const meSchema = userSchema.extend({
  actorKind: z.string(),
  permissions: z.array(z.string()),
  approvalScopes: z.array(
    z.object({ unit_id: z.uuid(), permission: z.string() }),
  ),
});

export const rolesSchema = z.array(
  z.object({ role: z.string(), permissions: z.array(z.string()) }),
);
export const signinSchema = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(256) })
  .strict();
export const patchUserSchema = z
  .object({
    displayName: z.string().max(200).optional(),
    active: z.boolean().optional(),
    roles: z.array(z.string().min(1)).min(1).max(6).optional(),
    unitIds: z.array(z.uuid()).max(100).optional(),
    bankAccountIds: z.array(z.uuid()).max(100).optional(),
  })
  .strict();
export const createUserSchema = patchUserSchema.omit({ active: true }).extend({
  email: z.email().max(254),
  password: z.string().min(8).max(256),
  displayName: z.string().max(200),
  roles: z.array(z.string().min(1)).min(1).max(6),
});

export type User = z.infer<typeof userSchema>;
export type Me = z.infer<typeof meSchema>;
export type Signin = z.infer<typeof signinSchema>;
export const newPasswordSchema = z
  .object({ newPassword: z.string().min(8).max(256) })
  .strict();
export const signinResultSchema = z.union([
  meSchema,
  z.object({ requiresNewPassword: z.literal(true) }),
]);
export type SigninInput = Signin | z.infer<typeof newPasswordSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type PatchUser = z.infer<typeof patchUserSchema>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return "Check the entered values and try again.";
    case 401:
      return "Sign in again or check your email and password.";
    case 403:
      return "You do not have access to this workspace or action.";
    case 404:
      return "The requested resource could not be found.";
    case 409:
      return "This change conflicts with an existing user or access scope.";
    case 429:
      return "Too many requests. Wait a moment and try again.";
    default:
      return "The service is temporarily unavailable. Please try again.";
  }
}
