// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GET,
  POST,
  PATCH,
  DELETE,
} from "@/app/api/[tenant]/[...resource]/route";
import { backend } from "@/services/backend";
import { z } from "zod";
import { member, admin, other, newUser, tenantId } from "./fixtures";
import { tenantBackend } from "./setup";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn<typeof fetch>();
const tokens = {
  accessToken: "private-access-token",
  expiresIn: 3600,
  refreshToken: "private-refresh",
};

function call(
  path: string,
  method = "GET",
  body?: unknown,
  options: {
    cookie?: boolean;
    origin?: string;
    slug?: string;
    host?: string;
    raw?: string;
  } = {},
) {
  const slug = options.slug ?? "vantara";
  const headers = new Headers({
    origin: options.origin ?? "http://localhost:3000",
    host: options.host ?? "localhost:3000",
  });
  if (options.cookie !== false) headers.set("cookie", `vantara-${slug}=token`);
  const request = new NextRequest(`http://localhost:3000/api/${slug}/${path}`, {
    method,
    headers,
    body:
      options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const handler =
    method === "POST"
      ? POST
      : method === "PATCH"
        ? PATCH
        : method === "DELETE"
          ? DELETE
          : GET;

  return handler(request, {
    params: Promise.resolve({
      tenant: slug,
      resource: path.split("?")[0].split("/"),
    }),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("tenant session boundary", () => {
  it("compares browser origin to the public Host, not Next's internal bind address", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json(member));
    const request = new NextRequest("http://0.0.0.0:3217/api/vantara/signin", {
      method: "POST",
      headers: {
        origin: "http://vantara.localhost:3217",
        host: "vantara.localhost:3217",
      },
      body: JSON.stringify({ email: member.email, password: "secret" }),
    });
    expect(
      (
        await POST(request, {
          params: Promise.resolve({ tenant: "vantara", resource: ["signin"] }),
        })
      ).status,
    ).toBe(200);
  });

  it("can use the URL authority when a Host header is absent", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/vantara/logout",
      { method: "POST", headers: { origin: "http://localhost:3000" } },
    );
    expect(
      (
        await POST(request, {
          params: Promise.resolve({ tenant: "vantara", resource: ["logout"] }),
        })
      ).status,
    ).toBe(204);
  });

  it("sets a host-only HttpOnly cookie only after active tenant membership verification", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json(member));
    const response = await call(
      "signin",
      "POST",
      { email: member.email, password: "secret" },
      { cookie: false },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(member);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("set-cookie")).not.toContain("Domain=");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const headers = fetchMock.mock.calls[1][1]?.headers as Headers;
    expect(headers.get("authorization")).toBe(`Bearer ${tokens.accessToken}`);
    expect(headers.get("x-tenant-id")).toBe(tenantId);
  });

  it("secures production cookies and expires them on logout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    fetchMock
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json(member));
    expect(
      (
        await call("signin", "POST", {
          email: member.email,
          password: "secret",
        })
      ).headers.get("set-cookie"),
    ).toContain("Secure");
    const response = await call("logout", "POST");
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each([
    { ...member, active: false },
    { ...member, tenant_id: other.id },
  ])(
    "rejects wrong or inactive memberships without setting a session",
    async (me) => {
      fetchMock
        .mockResolvedValueOnce(Response.json(tokens))
        .mockResolvedValueOnce(Response.json(me));
      const response = await call("signin", "POST", {
        email: member.email,
        password: "secret",
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it.each([undefined, "https://attacker.test"])(
    "rejects cross-origin writes including login and logout",
    async (origin) => {
      const response = await call("logout", "POST", undefined, {
        origin: origin ?? "",
      });
      expect(response.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown tenants, domain mismatches, and missing sessions", async () => {
    vi.stubEnv("TENANT_NOT_FOUND_REDIRECT_URL", "https://www.barte.com");
    expect(
      (await call("me", "GET", undefined, { slug: "missing" })).status,
    ).toBe(404);
    const second = {
      id: other.id,
      slug: "second",
      name: "Second",
      primary: "#000000",
      domains: ["second.test"],
    };
    tenantBackend.mockResolvedValue([
      {
        ...second,
        id: tenantId,
        slug: "vantara",
        domains: ["vantara.localhost"],
      },
      second,
    ]);
    expect(
      (await call("me", "GET", undefined, { host: "second.test" })).status,
    ).toBe(404);
    const response = await call("me", "GET", undefined, { cookie: false });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { email: "invalid", password: "" },
    { email: member.email, password: "secret", tenantId },
  ])("rejects invalid signin payloads", async (body) => {
    expect((await call("signin", "POST", body)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["{", "x".repeat(32769)])(
    "rejects malformed or oversized bodies",
    async (raw) => {
      expect((await call("signin", "POST", undefined, { raw })).status).toBe(
        400,
      );
    },
  );

  it("returns current identity and propagates expired authentication safely", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(member));
    expect(await (await call("me")).json()).toEqual(member);
    fetchMock.mockResolvedValueOnce(
      new Response("internal info", { status: 401 }),
    );
    const response = await call("me");
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("internal info");
  });

  it.each([
    { ...member, active: false },
    { ...member, tenant_id: other.id },
  ])("checks tenant membership on every authenticated request", async (me) => {
    fetchMock.mockResolvedValueOnce(Response.json(me));
    expect((await call("me")).status).toBe(403);
  });
});

describe("admin API allowlist", () => {
  it("denies non-admins before forwarding user requests", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(member));
    expect((await call("users")).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lists users with validated pagination and reads roles", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(admin))
      .mockResolvedValueOnce(Response.json([other]));
    expect(await (await call("users?offset=20&limit=20")).json()).toEqual([
      other,
    ]);
    expect(fetchMock.mock.calls[1][0]).toContain("users?offset=20&limit=20");
    fetchMock
      .mockResolvedValueOnce(Response.json(admin))
      .mockResolvedValueOnce(
        Response.json([{ role: "ap", permissions: ["pay"] }]),
      );
    expect((await call("users/roles")).status).toBe(200);
    fetchMock
      .mockResolvedValueOnce(Response.json(admin))
      .mockResolvedValueOnce(Response.json([]));
    expect((await call("users")).status).toBe(200);
    expect(fetchMock.mock.calls[5][0]).toContain("users?offset=0&limit=20");
  });

  it.each(["offset=-1", "offset=no", "limit=0", "limit=101", "limit=oops"])(
    "rejects invalid pagination: %s",
    async (query) => {
      fetchMock.mockResolvedValueOnce(Response.json(admin));
      expect((await call(`users?${query}`)).status).toBe(400);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("creates, patches, and deactivates a user", async () => {
    for (const [method, path, body, status] of [
      ["POST", "users", newUser, 201],
      ["PATCH", `users/${other.id}`, { active: false }, 200],
      ["DELETE", `users/${other.id}`, undefined, 204],
    ] as const) {
      fetchMock
        .mockResolvedValueOnce(Response.json(admin))
        .mockResolvedValueOnce(
          status === 204
            ? new Response(null, { status: 204 })
            : Response.json(other),
        );
      expect((await call(path, method, body)).status).toBe(status);
    }
  });

  it.each([
    ["POST", "users", {}],
    ["PATCH", `users/${other.id}`, { roles: [] }],
    ["PATCH", `users/${other.id}`, { tenant_id: tenantId }],
  ])("rejects invalid admin mutations", async (method, path, body) => {
    fetchMock.mockResolvedValueOnce(Response.json(admin));
    expect((await call(String(path), String(method), body)).status).toBe(400);
  });

  it.each(["PATCH", "DELETE"])(
    "blocks self administration via %s",
    async (method) => {
      fetchMock.mockResolvedValueOnce(Response.json(admin));
      expect(
        (
          await call(
            `users/${admin.id}`,
            method,
            method === "PATCH" ? {} : undefined,
          )
        ).status,
      ).toBe(403);
    },
  );

  it.each(["private", "users/not-a-uuid", `users/${other.id}/extra`])(
    "does not become an arbitrary backend proxy: %s",
    async (path) => {
      fetchMock.mockResolvedValueOnce(Response.json(admin));
      expect((await call(path)).status).toBe(404);
    },
  );

  it("fails closed when tenant branding is unavailable", async () => {
    tenantBackend.mockRejectedValue(new Error("Branding unavailable"));
    expect((await call("me")).status).toBe(503);
  });
});

describe("backend fetch boundary", () => {
  it("keeps backend address private and bounds requests", async () => {
    vi.stubEnv("BACKEND_URL", "http://backend:8080");
    fetchMock.mockResolvedValueOnce(Response.json("ok"));
    expect(await backend("hello", z.string())).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:8080/api/hello",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([null, {}, { ...tokens, expiresIn: -1 }])(
    "rejects malformed signin data",
    async (value) => {
      fetchMock.mockResolvedValueOnce(Response.json(value));
      expect(
        (await call("signin", "POST", { email: member.email, password: "x" }))
          .status,
      ).toBe(502);
    },
  );

  it("converts invalid JSON and network failures to safe responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("invalid json"));
    expect((await call("me")).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new Error("private address"));
    const response = await call("me");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private address");
  });
});
