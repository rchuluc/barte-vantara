import "server-only";
import { z } from "zod";
import { ApiError, statusMessage } from "@/lib/contracts";

export async function backend<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    tenantId?: string;
  } = {},
): Promise<T> {
  const headers = new Headers({ "Content-Type": "application/json" });

  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (options.tenantId) headers.set("X-Tenant-Id", options.tenantId);

  let response: Response;

  try {
    response = await fetch(
      `${process.env.BACKEND_URL ?? "http://localhost:8080"}/api/${path}`,
      {
        method: options.method ?? "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw new ApiError(503, statusMessage(503));
  }

  if (!response.ok)
    throw new ApiError(response.status, statusMessage(response.status));

  try {
    return schema.parse(response.status === 204 ? null : await response.json());
  } catch {
    throw new ApiError(
      502,
      "The service returned an invalid response. Please try again.",
    );
  }
}
