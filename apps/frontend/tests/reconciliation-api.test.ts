// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/[...resource]/route";
import { member, tenantId } from "./fixtures";

vi.mock("server-only", () => ({}));
const fetchMock = vi.fn<typeof fetch>();
const id = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValueOnce(Response.json(member));
  vi.stubGlobal("fetch", fetchMock);
});

function call(
  path: string,
  method = "GET",
  body?: unknown,
  origin = "http://vantara.localhost:3000",
) {
  return (method === "GET" ? GET : POST)(
    new NextRequest(`http://vantara.localhost:3000/api/${path}`, {
      method,
      headers: {
        host: "vantara.localhost:3000",
        origin,
        cookie: "vantara-vantara=token",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ resource: path.split("/") }) },
  );
}

it("proxies database records for ordinary members with the server-resolved tenant", async () => {
  const data = {
    actorId: id,
    banks: [],
    titles: [],
    candidates: [],
    allocations: [],
    decisions: [],
  };
  fetchMock.mockResolvedValueOnce(Response.json(data));
  const response = await call("reconciliation");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(data);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(
    (fetchMock.mock.calls[1][1]?.headers as Headers).get("X-Tenant-Id"),
  ).toBe(tenantId);
});

it.each(["banks", "titles"])(
  "validates %s provenance at the boundary",
  async (kind) => {
    const detail = {
      normalized: { amount_minor: 567000 },
      source: {
        locator: "record:5",
        raw_text: "raw",
        object_ref: "key",
        source_version: "v1",
        ingestion_id: null,
        filename: null,
      },
      history: [],
    };
    fetchMock.mockResolvedValueOnce(Response.json(detail));
    expect((await call(`reconciliation/${kind}/${id}/details`)).status).toBe(
      200,
    );
  },
);

it.each([
  [
    `reconciliation/${id}`,
    {
      id,
      action: "draft",
      allocations: [{ titleId: id, amountMinor: 567000 }],
    },
  ],
  [`reconciliation/${id}`, { id, action: "pending" }],
  [
    `reconciliation/${id}`,
    { id, action: "rejected_suggestion", rejectedTitleId: id },
  ],
  [`reconciliation/decisions/${id}/review`, { decision: "confirmed" }],
  [`reconciliation/decisions/${id}/review`, { decision: "rejected" }],
])("proxies validated mutation %s", async (path, body) => {
  fetchMock.mockResolvedValueOnce(Response.json({ id }));
  expect((await call(path, "POST", body)).status).toBe(200);
});

it.each([
  [
    `reconciliation/${id}`,
    { id, action: "draft", allocations: [{ titleId: id, amountMinor: -1 }] },
  ],
  [
    `reconciliation/${id}`,
    { id, action: "draft", allocations: [{ titleId: id, amountMinor: 1.5 }] },
  ],
  [`reconciliation/decisions/${id}/review`, { decision: "approve" }],
])("rejects invalid financial commands %s", async (path, body) => {
  expect((await call(path, "POST", body)).status).toBe(400);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  "reconciliation/invalid",
  `reconciliation/banks/invalid/details`,
  `reconciliation/other/${id}/details`,
  `reconciliation/banks/${id}/other`,
  `reconciliation/decisions/invalid/review`,
  `reconciliation/decisions/${id}/other`,
])("does not proxy unrecognized paths %s", async (path) => {
  expect((await call(path, "POST", {})).status).toBe(404);
});

it("rejects cross-origin writes before calling the backend", async () => {
  expect(
    (await call(`reconciliation/${id}`, "POST", {}, "https://elsewhere.test"))
      .status,
  ).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects malformed service responses", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ banks: [{ amount_minor: "untrusted" }] }),
  );
  expect((await call("reconciliation")).status).toBe(502);
});
