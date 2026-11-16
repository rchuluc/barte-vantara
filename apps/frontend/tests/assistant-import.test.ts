// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { saveAssistantImport } from "@/services/assistant-import";
import { assistantImportSchema } from "@/lib/assistant-import";
import { job, unitId } from "./import-fixtures";

const backend = vi.hoisted(() => vi.fn());
vi.mock("@/services/backend", () => ({ backend }));
const input = {
  unitId,
  currency: "BRL" as const,
  rows: [
    {
      sourceMessageNumber: 1,
      party_name: 'A, "B"',
      document_ref: "0001",
      due_on: "2026-12-01",
      amount: "12.50",
    },
  ],
};
const options = { token: "token", tenantId: "tenant" };

beforeEach(() => {
  backend
    .mockReset()
    .mockImplementation(async (path: string) =>
      path === "business-units"
        ? [{ id: unitId, name: "Main" }]
        : { ...job, state: "completed", processed: 1 },
    );
});

it("preserves exact identifiers, decimals and long source text in escaped CSV cells with a stable retry key", async () => {
  const source =
    'invoice "0001"\r\n' + "x".repeat(15983) + "🚚" + "x".repeat(47900);
  await saveAssistantImport(input, [source], "call-1", options);
  const upload = backend.mock.calls[1][2];
  const csv = new TextDecoder().decode(upload.rawBody);
  expect(csv).toContain('"A, ""B""","0001","2026-12-01","12.50"');
  expect(csv).toContain('invoice ""0001""\r\n');
  expect(csv).toContain("🚚");
  expect(csv).not.toContain("\uFFFD");
  await saveAssistantImport(input, [source], "call-1", options);
  expect(backend.mock.calls[3][2].idempotencyKey).toBe(upload.idempotencyKey);
  expect(backend.mock.calls).toHaveLength(4);
});

it.each(["failed", "uploading"])(
  "resumes %s imports before confirming and processing",
  async (state) => {
    backend
      .mockResolvedValueOnce([{ id: unitId, name: "Main" }])
      .mockResolvedValueOnce({ ...job, state })
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({ ...job, state: "processing" })
      .mockResolvedValueOnce({
        ...job,
        state: "completed",
        processed: 1,
        rejected: 1,
      });
    expect(
      await saveAssistantImport(input, ["source"], "call-1", options),
    ).toMatchObject({ rejected: 1, processed: 1 });
    expect(backend.mock.calls.map((call) => call[0])).toEqual([
      "business-units",
      expect.stringContaining("imports?"),
      expect.stringMatching(/\/prepare$/),
      expect.stringMatching(/\/confirm$/),
      expect.stringMatching(/\/process$/),
    ]);
    expect(backend.mock.calls[3][2].body).toMatchObject({
      unitId,
      currency: "BRL",
      columns: { amount: "amount", party_name: "party_name" },
    });
  },
);

it("rejects destinations the user cannot access", async () => {
  backend.mockResolvedValueOnce([]);
  await expect(
    saveAssistantImport(input, ["source"], "call", options),
  ).rejects.toMatchObject({ status: 403 });
  expect(backend).toHaveBeenCalledTimes(1);
});

it("rejects nonexistent source references before writing", async () => {
  await expect(
    saveAssistantImport(input, [], "call", options),
  ).rejects.toMatchObject({ status: 400 });
  expect(backend).toHaveBeenCalledTimes(1);
});

it("propagates backend failures without claiming success", async () => {
  backend
    .mockResolvedValueOnce([{ id: unitId, name: "Main" }])
    .mockRejectedValueOnce(new Error("Unavailable"));
  await expect(
    saveAssistantImport(input, ["source"], "call", options),
  ).rejects.toThrow("Unavailable");
});

it.each(["0.00", "-1.00", "12.345", "1e3", "99999999999999999.00"])(
  "rejects invalid money %s",
  (amount) => {
    expect(
      assistantImportSchema.safeParse({
        ...input,
        rows: [{ ...input.rows[0], amount }],
      }).success,
    ).toBe(false);
  },
);
