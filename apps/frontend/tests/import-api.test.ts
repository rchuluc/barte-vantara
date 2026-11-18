// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PATCH } from "@/app/api/[...resource]/route";
import { importProxy } from "@/services/import-proxy";
import { MAX_IMPORT_BYTES, importSummarySchema } from "@/lib/import-contracts";
import {
  job,
  importer,
  importId,
  unitId,
  mapping,
  sourceRow,
} from "./import-fixtures";
import { member, tenantId } from "./fixtures";

vi.mock("server-only", () => ({}));
const fetchMock = vi.fn<typeof fetch>();
const options = { token: "token", tenantId, method: "POST" };

function call(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const request = new NextRequest(`http://vantara.localhost:3000/api/${path}`, {
    method,
    headers: {
      host: "vantara.localhost:3000",
      origin: "http://vantara.localhost:3000",
      cookie: "vantara-vantara=token",
      ...headers,
    },
    body:
      typeof body === "string"
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });

  return (method === "POST" ? POST : method === "PATCH" ? PATCH : GET)(
    request,
    { params: Promise.resolve({ resource: path.split("?")[0].split("/") }) },
  );
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValueOnce(Response.json(importer));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  ["imports", [job]],
  ["imports?offset=20&limit=20", [job]],
  ["business-units", [{ id: unitId, name: "HQ", active: true }]],
  [`imports/${importId}`, job],
  [`imports/${importId}/rows`, [sourceRow]],
])("proxies validated tenant-scoped reads: %s", async (path, result) => {
  fetchMock.mockResolvedValueOnce(Response.json(result));
  const response = await call(path as string);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    String(path).startsWith("imports?") || path === "imports"
      ? [importSummarySchema.parse(job)]
      : result,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetchMock.mock.calls[1][1]?.headers).toEqual(
    expect.objectContaining({}),
  );
  const headers = fetchMock.mock.calls[1][1]?.headers as Headers;
  expect(headers.get("X-Tenant-Id")).toBe(tenantId);
});

it.each(["confirm", "prepare", "process"])(
  "proxies %s without requiring configure permission",
  async (action) => {
    fetchMock.mockResolvedValueOnce(Response.json(job));
    const response = await call(
      `imports/${importId}/${action}`,
      "POST",
      action === "confirm" ? mapping : {},
    );
    expect(response.status).toBe(200);
  },
);

it("forwards corrections as an array, not an object", async () => {
  fetchMock.mockResolvedValueOnce(Response.json(job));
  expect(
    (await call(`imports/${importId}/rows/2`, "PATCH", sourceRow.cells)).status,
  ).toBe(200);
  expect(fetchMock.mock.calls[1][1]?.body).toBe(
    JSON.stringify(sourceRow.cells),
  );
});

it("uploads raw bytes with an idempotency key and strips private fields", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ ...job, object_key: "private", owner_id: importer.id }),
  );
  const response = await call(
    "imports?filename=test.csv&kind=receivable",
    "POST",
    "a,b\n1,2",
    { "Idempotency-Key": importId },
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(job);
  expect(
    new TextDecoder().decode(fetchMock.mock.calls[1][1]?.body as ArrayBuffer),
  ).toBe("a,b\n1,2");
  expect(
    (fetchMock.mock.calls[1][1]?.headers as Headers).get("Idempotency-Key"),
  ).toBe(importId);
});

it("proxies a bounded preview without invoking the persistence endpoint", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ ...job, rows: [sourceRow] }));
  const response = await call(
    "imports/preview?filename=sample.csv&kind=receivable",
    "POST",
    "Name\nAcme",
    { "Idempotency-Key": importId },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id: importId,
    rows: [sourceRow],
  });
  expect(String(fetchMock.mock.calls[1][0])).toContain("/api/imports/preview?");
  expect(
    new TextDecoder().decode(fetchMock.mock.calls[1][1]?.body as ArrayBuffer),
  ).toBe("Name\nAcme");
});

it.each([
  ["imports?filename=x.csv&kind=other", "POST", "bytes"],
  ["imports?filename=x.exe&kind=bank", "POST", "bytes"],
  ["imports?kind=bank", "POST", "bytes"],
  ["imports?offset=-1", "GET"],
  ["imports?limit=0", "GET"],
  ["imports?limit=101", "GET"],
  ["imports?limit=x", "GET"],
  ["imports/nope/rows", "GET"],
  ["imports/nope", "GET"],
  [`imports/${importId}/confirm`, "POST", {}],
  [`imports/${importId}/prepare`, "POST", { invalid: true }],
  [`imports/${importId}/rows/2`, "PATCH", { cells: [] }],
])("rejects invalid input %s %s", async (path, method, body = undefined) => {
  expect(
    (
      await call(path as string, method as string, body, {
        "Idempotency-Key": importId,
      })
    ).status,
  ).toBe(400);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("requires a stable upload key", async () => {
  expect(
    (await call("imports?filename=x.csv&kind=bank", "POST", "bytes")).status,
  ).toBe(400);
});

it("rejects uploads without the dataset permission before reading the file", async () => {
  fetchMock.mockReset().mockResolvedValueOnce(Response.json(member));
  expect(
    (
      await call("imports?filename=x.csv&kind=bank", "POST", "bytes", {
        "Idempotency-Key": importId,
      })
    ).status,
  ).toBe(403);
});

it("rejects oversized uploads from the declared length", async () => {
  expect(
    (
      await call("imports?filename=x.csv&kind=bank", "POST", "bytes", {
        "Idempotency-Key": importId,
        "Content-Length": String(MAX_IMPORT_BYTES + 1),
      })
    ).status,
  ).toBe(413);
});

it("enforces the actual stream size even without Content-Length", async () => {
  const request = new NextRequest(
    "http://vantara.localhost/api/imports?filename=x.csv&kind=bank",
    {
      method: "POST",
      headers: { "Idempotency-Key": importId },
      body: new Uint8Array(MAX_IMPORT_BYTES + 1),
    },
  );
  await expect(
    importProxy(request, ["imports"], undefined, importer, options),
  ).rejects.toMatchObject({ status: 413 });
});

it.each([undefined, ""])("rejects missing or empty file data", async (body) => {
  expect(
    (
      await call("imports?filename=x.csv&kind=bank", "POST", body, {
        "Idempotency-Key": importId,
      })
    ).status,
  ).toBe(400);
});

it("rejects unsupported actions and malformed upstream data", async () => {
  expect((await call(`imports/${importId}/unknown`)).status).toBe(404);
  fetchMock
    .mockResolvedValueOnce(Response.json(importer))
    .mockResolvedValueOnce(Response.json({}));
  expect((await call(`imports/${importId}`)).status).toBe(502);
});

it("keeps backend scope denials and conflicts intact", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
  expect((await call(`imports/${importId}`)).status).toBe(403);
  fetchMock
    .mockResolvedValueOnce(Response.json(importer))
    .mockResolvedValueOnce(new Response(null, { status: 409 }));
  expect((await call(`imports/${importId}/process`, "POST", {})).status).toBe(
    409,
  );
});
