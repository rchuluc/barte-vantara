import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { assistantImportSchema } from "@/lib/assistant-import";
import { importSchema, unitsSchema } from "@/lib/import-contracts";
import { ApiError, statusMessage } from "@/lib/contracts";
import { backend } from "@/services/backend";

export async function saveAssistantImport(
  input: z.infer<typeof assistantImportSchema>,
  sources: string[],
  toolCallId: string,
  options: { token: string; tenantId: string },
) {
  const units = await backend("business-units", unitsSchema, options);
  if (!units.some((unit) => unit.id === input.unitId))
    throw new ApiError(403, statusMessage(403));
  if (input.rows.some((row) => !sources[row.sourceMessageNumber - 1]))
    throw new ApiError(400, statusMessage(400));

  const columns = ["party_name", "document_ref", "due_on", "amount"] as const;
  // Keep the original text in bounded cells alongside the normalized fields.
  const headers = [
    ...columns,
    "source_type",
    ...Array.from({ length: 8 }, (_, index) => `source_${index + 1}`),
  ];
  const records = input.rows.map((row) => {
    const source = Array.from(sources[row.sourceMessageNumber - 1]);
    return [
      ...columns.map((column) => row[column]),
      "agent_unstructured",
      ...Array.from({ length: 8 }, (_, index) =>
        source.slice(index * 8000, (index + 1) * 8000).join(""),
      ),
    ];
  });
  const csv = [headers, ...records]
    .map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n");
  // The same approved call always addresses the same backend import, including retries.
  const hash = createHash("sha256")
    .update(JSON.stringify([options.tenantId, toolCallId, input, csv]))
    .digest("hex");
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const post = { ...options, method: "POST" };
  let job = await backend(
    "imports?filename=assistant-import.csv&kind=payable",
    importSchema,
    {
      ...post,
      idempotencyKey: id,
      rawBody: new TextEncoder().encode(csv).buffer,
    },
  );
  if (job.state === "failed" || job.state === "uploading")
    job = await backend(`imports/${id}/prepare`, importSchema, {
      ...post,
      body: {},
    });
  if (job.state === "mapping")
    job = await backend(`imports/${id}/confirm`, importSchema, {
      ...post,
      body: {
        columns: Object.fromEntries(columns.map((column) => [column, column])),
        unitId: input.unitId,
        currency: input.currency,
        dateFormat: "uuuu-MM-dd",
        decimal: ".",
      },
    });
  if (job.state === "processing")
    job = await backend(`imports/${id}/process`, importSchema, {
      ...post,
      body: {},
    });
  return {
    id: job.id,
    state: job.state,
    total: job.total,
    processed: job.processed,
    rejected: job.rejected,
  };
}
