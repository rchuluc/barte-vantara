// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PATCH, DELETE } from "@/app/api/[...resource]/route";
import { admin, member, other } from "./fixtures";

const fetchMock = vi.fn<typeof fetch>();
const unit = { id: other.id, name: "HQ", active: true };
const account = {
  id: other.id,
  unit_ids: [other.id],
  configurable: true,
  bank_code: "341",
  account_ref: "123",
  currency: "BRL",
  active: true,
};

function call(path: string, method = "GET", body?: unknown) {
  const request = new NextRequest(`http://vantara.localhost:3000/api/${path}`, {
    method,
    headers: {
      host: "vantara.localhost:3000",
      origin: "http://vantara.localhost:3000",
      cookie: "vantara-vantara=token",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { GET, POST, PATCH, DELETE }[method]!(request, {
    params: Promise.resolve({ resource: path.split("/") }),
  });
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValueOnce(Response.json(admin));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  ["business-units", unit, { name: "HQ" }],
  [
    "bank-accounts",
    account,
    {
      unitIds: [other.id],
      bankCode: "341",
      accountRef: "123",
      currency: "BRL",
    },
  ],
])("validates and proxies creation of %s", async (path, result, body) => {
  fetchMock.mockResolvedValueOnce(Response.json(result));
  const response = await call(String(path), "POST", body);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(result);
});

it.each([
  ["business-units", unit, { name: "HQ", active: false }],
  [
    "bank-accounts",
    account,
    { bankCode: "341", accountRef: "123", active: false },
  ],
])("proxies disabling %s through PATCH", async (path, result, body) => {
  fetchMock.mockResolvedValueOnce(Response.json({ ...result, active: false }));
  const response = await call(`${path}/${other.id}`, "PATCH", body);
  expect(response.status).toBe(200);
  expect((await response.json()).active).toBe(false);
});

it.each(["business-units", "bank-accounts"])(
  "rejects unauthorized writes and deletion for %s",
  async (path) => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json(member));
    expect((await call(path, "POST", {})).status).toBe(403);
    fetchMock.mockResolvedValueOnce(Response.json(admin));
    expect((await call(`${path}/${other.id}`, "DELETE")).status).toBe(404);
  },
);

it.each([
  ["business-units", { name: " " }],
  ["bank-accounts", { unitId: "bad", currency: "USD" }],
  [
    `bank-accounts/${other.id}`,
    { bankCode: "341", accountRef: "123", active: false, unitId: other.id },
  ],
])("rejects invalid or immutable fields for %s", async (path, body) => {
  expect(
    (
      await call(
        String(path),
        String(path).includes("/") ? "PATCH" : "POST",
        body,
      )
    ).status,
  ).toBe(400);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("rejects malformed bank-account responses", async () => {
  fetchMock.mockResolvedValueOnce(Response.json([{ id: "invalid" }]));
  expect((await call("bank-accounts")).status).toBe(502);
});
