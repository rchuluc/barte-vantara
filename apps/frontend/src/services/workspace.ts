import { z } from "zod";
import {
  ApiError,
  statusMessage,
  meSchema,
  userSchema,
  rolesSchema,
  type SigninInput,
  signinResultSchema,
  type CreateUser,
  type PatchUser,
} from "@/lib/contracts";

async function request<T>(
  tenant: string,
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`/api/${tenant}/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError(
      503,
      "Unable to connect. Check your connection and try again.",
    );
  }

  if (!response.ok)
    throw new ApiError(response.status, statusMessage(response.status));

  try {
    return schema.parse(response.status === 204 ? null : await response.json());
  } catch {
    throw new ApiError(502, "Invalid response. Please try again.");
  }
}

export const workspace = {
  me: (tenant: string) => request(tenant, "me", meSchema),
  signin: (tenant: string, body: SigninInput) =>
    request(
      tenant,
      "newPassword" in body ? "signin/password" : "signin",
      signinResultSchema,
      "POST",
      body,
    ),
  logout: (tenant: string) => request(tenant, "logout", z.null(), "POST"),
  users: (tenant: string, offset: number) =>
    request(tenant, `users?offset=${offset}&limit=20`, z.array(userSchema)),
  roles: (tenant: string) => request(tenant, "users/roles", rolesSchema),
  create: (tenant: string, body: CreateUser) =>
    request(tenant, "users", userSchema, "POST", body),
  update: (tenant: string, id: string, body: PatchUser) =>
    request(tenant, `users/${id}`, userSchema, "PATCH", body),
  deactivate: (tenant: string, id: string) =>
    request(tenant, `users/${id}`, z.null(), "DELETE"),
};
