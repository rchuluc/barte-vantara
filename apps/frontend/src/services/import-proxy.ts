import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, statusMessage, type Me } from "@/lib/contracts";
import {
  importPreviewSchema,
  MAX_IMPORT_BYTES,
  datasetSchema,
  importPermission,
  importSchema,
  importSummarySchema,
  importRowSchema,
  unitsSchema,
  mappingSchema,
} from "@/lib/import-contracts";
import { backend } from "@/services/backend";

export async function importProxy(
  request: NextRequest,
  resource: string[],
  body: unknown,
  me: Me,
  options: { token: string; tenantId: string; method: string },
) {
  const path = resource.join("/");
  const method = request.method;
  const query = request.nextUrl.searchParams;
  const reply = (data: unknown, status = 200) =>
    NextResponse.json(data, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  const invalid = () => new ApiError(400, statusMessage(400));

  if (path === "business-units" && method === "GET")
    return reply(await backend(path, unitsSchema, options));
  if (
    (resource.length === 1 || path === "imports/preview") &&
    method === "POST"
  ) {
    const kind = datasetSchema.safeParse(query.get("kind"));
    const filename = query.get("filename") ?? "";
    const key = request.headers.get("Idempotency-Key");
    if (
      !kind.success ||
      !filename ||
      filename.length > 200 ||
      !/\.(csv|xlsx)$/i.test(filename) ||
      !z.uuid().safeParse(key).success
    )
      throw invalid();
    if (!me.permissions.includes(importPermission(kind.data)))
      throw new ApiError(403, statusMessage(403));
    if (Number(request.headers.get("content-length")) > MAX_IMPORT_BYTES)
      throw new ApiError(413, "Maximum upload is 100 MiB.");
    const reader = request.body?.getReader();
    if (!reader) throw invalid();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMPORT_BYTES) {
          await reader.cancel();
          throw new ApiError(413, "Maximum upload is 100 MiB.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!size) throw invalid();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (path === "imports/preview")
      return reply(
        await backend(
          `imports/preview?${new URLSearchParams({ filename, kind: kind.data })}`,
          importPreviewSchema,
          { ...options, rawBody: bytes.buffer, idempotencyKey: key! },
        ),
      );

    return reply(
      await backend(
        `imports?${new URLSearchParams({ filename, kind: kind.data })}`,
        importSchema,
        { ...options, rawBody: bytes.buffer, idempotencyKey: key! },
      ),
      201,
    );
  }
  if (
    method === "GET" &&
    (resource.length === 1 || (resource.length === 3 && resource[2] === "rows"))
  ) {
    const parameter = resource.length === 1 ? "offset" : "after";
    const offset = query.get(parameter) ?? "0";
    const limit = query.get("limit") ?? "20";
    if (
      !/^\d{1,9}$/.test(offset) ||
      !/^\d{1,3}$/.test(limit) ||
      Number(limit) < 1 ||
      Number(limit) > 100
    )
      throw invalid();
    if (resource.length === 3 && !z.uuid().safeParse(resource[1]).success)
      throw invalid();
    const url = `${path}?${parameter}=${offset}&limit=${limit}`;
    return resource.length === 1
      ? reply(await backend(url, z.array(importSummarySchema), options))
      : reply(await backend(url, z.array(importRowSchema), options));
  }
  if (!z.uuid().safeParse(resource[1]).success) throw invalid();
  if (resource.length === 2 && method === "GET")
    return reply(await backend(path, importSchema, options));
  if (
    resource.length === 3 &&
    method === "POST" &&
    ["prepare", "process", "confirm"].includes(resource[2])
  ) {
    const parsed =
      resource[2] === "confirm"
        ? mappingSchema.safeParse(body)
        : z.object({}).strict().safeParse(body);
    if (!parsed.success) throw invalid();
    return reply(
      await backend(path, importSchema, { ...options, body: parsed.data }),
    );
  }
  if (
    resource.length === 4 &&
    resource[2] === "rows" &&
    method === "PATCH" &&
    /^[1-9]\d{0,8}$/.test(resource[3])
  ) {
    const parsed = z.array(z.string().max(16384)).max(1000).safeParse(body);
    if (!parsed.success) throw invalid();
    return reply(
      await backend(path, importSchema, { ...options, body: parsed.data }),
    );
  }
  throw new ApiError(404, statusMessage(404));
}
