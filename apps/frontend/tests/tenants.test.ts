import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  tenants,
  tenantByHost,
  tenantBySlug,
  brandForeground,
} from "@/lib/tenants";
import { proxy } from "@/proxy";
import { tenantNotFoundRedirectUrl } from "@/lib/tenant-redirect";
import { tenantId, other } from "./fixtures";

vi.unmock("@/services/backend");

const tenant = {
  id: tenantId,
  slug: "vantara",
  name: "Vantara",
  primary: "#175C4C",
  domains: ["vantara.localhost", "vantara.com.br"],
};
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => Response.json([tenant]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(["development", "production", "test"])(
  "loads backend branding in %s without environment configuration fallback",
  async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("TENANTS_JSON", "ignored");
    expect(await tenants()).toEqual([tenant]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/tenants",
      expect.objectContaining({ cache: "no-store" }),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json([{ ...tenant, name: "Updated" }]),
    );
    expect((await tenants())[0].name).toBe("Updated");
    fetchMock.mockResolvedValueOnce(Response.json([]));
    expect(await tenants()).toEqual([]);
    fetchMock.mockResolvedValueOnce(Response.json({ invalid: true }));
    await expect(tenants()).rejects.toThrow("invalid response");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(tenants()).rejects.toThrow("unavailable");
  },
);

it("matches exact domains and slugs, never wildcard or lookalike suffixes", async () => {
  expect((await tenantBySlug("vantara"))?.id).toBe(tenantId);
  expect((await tenantByHost("VANTARA.LOCALHOST:3000"))?.name).toBe("Vantara");
  expect(await tenantByHost("vantara.localhost.evil.com")).toBeUndefined();
  expect(await tenantByHost("vantara.anything.com")).toBeUndefined();
  expect(await tenantBySlug("missing")).toBeUndefined();
});

it("supports a second independently branded workspace", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json([
      { ...tenant, id: other.id, slug: "acme", domains: ["acme.test"] },
    ]),
  );
  expect((await tenantByHost("acme.test"))?.slug).toBe("acme");
  expect(await tenantBySlug("vantara")).toBeUndefined();
});

it("rejects malformed colors and ambiguous routing", async () => {
  fetchMock.mockResolvedValueOnce(Response.json([tenant, tenant]));
  await expect(tenants()).rejects.toThrow("unique");
  fetchMock.mockResolvedValueOnce(
    Response.json([tenant, { ...tenant, slug: "other" }]),
  );
  await expect(tenants()).rejects.toThrow("unique");
  fetchMock.mockResolvedValueOnce(
    Response.json([{ ...tenant, primary: "url(evil)" }]),
  );
  await expect(tenants()).rejects.toThrow();
});

it("chooses readable branding text for light and dark backgrounds", () => {
  expect(brandForeground("#FFFFFF")).toBe("#000000");
  expect(brandForeground("#000000")).toBe("#FFFFFF");
  expect(brandForeground("#175C4C")).toBe("#FFFFFF");
});

it("rewrites tenant domains while preserving queries and platform paths", async () => {
  expect(
    (
      await proxy(new NextRequest("http://vantara.localhost/login?from=test"))
    ).headers.get("x-middleware-rewrite"),
  ).toBe("http://vantara.localhost/vantara/login?from=test");
  expect(
    (await proxy(new NextRequest("http://vantara.localhost/"))).headers.get(
      "x-middleware-rewrite",
    ),
  ).toContain("/vantara/dashboard");
  expect(
    (
      await proxy(new NextRequest("http://localhost/vantara/login"))
    ).headers.get("x-middleware-next"),
  ).toBe("1");
  expect(
    (
      await proxy(new NextRequest("http://vantara.localhost/vantara/login"))
    ).headers.get("x-middleware-next"),
  ).toBe("1");
});

it("rejects another tenant path on a mapped domain", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json([
      tenant,
      { ...tenant, id: other.id, slug: "acme", domains: ["acme.test"] },
    ]),
  );
  expect(
    (
      await proxy(
        new NextRequest("http://localhost/acme/login", {
          headers: { host: "vantara.localhost" },
        }),
      )
    ).status,
  ).toBe(404);
  vi.stubEnv("TENANT_NOT_FOUND_REDIRECT_URL", "https://owner.example/");
  const response = await proxy(
    new NextRequest("http://vantara.localhost/acme/login"),
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://owner.example/");
});

it("redirects unknown tenant URLs without forwarding their path or query", async () => {
  vi.stubEnv("TENANT_NOT_FOUND_REDIRECT_URL", "https://www.barte.com");
  for (const url of [
    "https://unknown.example/",
    "https://platform.example/missing/login?redirect=https://evil.test",
  ]) {
    const response = await proxy(new NextRequest(url));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://www.barte.com/");
  }
  expect(
    (
      await proxy(new NextRequest("http://localhost/vantara/login"))
    ).headers.get("x-middleware-next"),
  ).toBe("1");
  expect(
    (
      await proxy(new NextRequest("http://vantara.localhost/login"))
    ).headers.get("x-middleware-rewrite"),
  ).toContain("/vantara/login");
});

it("does not redirect backend outages as unknown tenants", async () => {
  vi.stubEnv("TENANT_NOT_FOUND_REDIRECT_URL", "https://owner.example/");
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  await expect(
    proxy(new NextRequest("https://unknown.example/")),
  ).rejects.toThrow("unavailable");
});

it("treats blank redirect configuration as disabled and accepts HTTP development destinations", () => {
  vi.stubEnv("TENANT_NOT_FOUND_REDIRECT_URL", "  ");
  expect(tenantNotFoundRedirectUrl()).toBeUndefined();
  vi.stubEnv("TENANT_NOT_FOUND_REDIRECT_URL", " http://localhost:4000/about ");
  expect(tenantNotFoundRedirectUrl()).toBe("http://localhost:4000/about");
});

it.each([
  "/relative",
  "not a URL",
  "javascript:alert(1)",
  "ftp://owner.example",
  "https://user@owner.example",
  "https://:password@owner.example",
])("rejects invalid redirect configuration %s", (url) => {
  vi.stubEnv("TENANT_NOT_FOUND_REDIRECT_URL", url);
  expect(tenantNotFoundRedirectUrl).toThrow();
});
