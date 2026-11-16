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

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
  upload?: { file: File; key: string },
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: upload
        ? {
            "Content-Type": "application/octet-stream",
            "Idempotency-Key": upload.key,
          }
        : { "Content-Type": "application/json" },
      body: upload
        ? upload.file
        : body === undefined
          ? undefined
          : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(upload ? 120000 : 20000),
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
  me: () => request("me", meSchema),
  signin: (body: SigninInput) =>
    request(
      "newPassword" in body ? "signin/password" : "signin",
      signinResultSchema,
      "POST",
      body,
    ),
  logout: () => request("logout", z.null(), "POST"),
  users: (offset: number) =>
    request(`users?offset=${offset}&limit=20`, z.array(userSchema)),
  roles: () => request("users/roles", rolesSchema),
  create: (body: CreateUser) => request("users", userSchema, "POST", body),
  update: (id: string, body: PatchUser) =>
    request(`users/${id}`, userSchema, "PATCH", body),
  deactivate: (id: string) => request(`users/${id}`, z.null(), "DELETE"),
};
