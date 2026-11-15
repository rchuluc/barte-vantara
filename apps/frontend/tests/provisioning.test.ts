// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/tenants/route";
import { POST as authenticate } from "@/app/api/[...resource]/route";
import { member, tenantId } from "./fixtures";

const tenant = {
  id: tenantId,
  slug: "vantara",
  name: "Vantara",
  primary: "#f0a500",
  domains: ["vantara.localhost"],
};

afterEach(() => vi.unstubAllGlobals());

it("forwards only validated provisioning with the automation bearer token", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(tenant));
  vi.stubGlobal("fetch", fetcher);
  const response = await POST(
    new NextRequest("https://example.com/api/admin/tenants", {
      method: "POST",
      headers: { authorization: "Bearer github-token" },
      body: JSON.stringify({ tenant, firstUserEmail: "admin@example.com" }),
    }),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(tenant);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetcher.mock.calls[0][1].headers.get("authorization")).toBe(
    "Bearer github-token",
  );
});

it.each([
  [undefined, "{}", 401],
  ["Basic invalid", "{}", 401],
  ["Bearer " + "x".repeat(16384), "{}", 401],
  ["Bearer token", "x".repeat(16385), 400],
  ["Bearer token", "{", 400],
  ["Bearer token", "{}", 400],
])(
  "rejects invalid provisioning input",
  async (authorization, body, status) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      new NextRequest("https://example.com/api/admin/tenants", {
        method: "POST",
        headers: authorization ? { authorization } : {},
        body,
      }),
    );
    expect(response.status).toBe(status);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it.each([401, 403, 409, 503])(
  "preserves backend rejection %s",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status })),
    );
    expect(
      (
        await POST(
          new NextRequest("https://example.com/api/admin/tenants", {
            method: "POST",
            headers: { authorization: "Bearer token" },
            body: JSON.stringify({ tenant, firstUserEmail: "a@example.com" }),
          }),
        )
      ).status,
    ).toBe(status);
  },
);

function signin(path: string, body: unknown, cookie?: string) {
  return authenticate(
    new NextRequest(`http://vantara.localhost:3000/api/${path}`, {
      method: "POST",
      headers: {
        origin: "http://vantara.localhost:3000",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({ resource: path.split("/") }),
    },
  );
}

it("keeps the challenge HttpOnly and verifies membership before creating the final session", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        challenge: "NEW_PASSWORD_REQUIRED",
        session: "private-session",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ accessToken: "access", expiresIn: 3600 }),
    )
    .mockResolvedValueOnce(Response.json(member));
  vi.stubGlobal("fetch", fetcher);
  const challenge = await signin("signin", {
    email: member.email,
    password: "temporary",
  });
  expect(await challenge.json()).toEqual({ requiresNewPassword: true });
  expect(challenge.headers.get("set-cookie")).toContain("HttpOnly");
  const pending = challenge.cookies.get("vantara-vantara-challenge")!;
  const response = await signin(
    "signin/password",
    { newPassword: "Replacement123!" },
    `${pending.name}=${encodeURIComponent(pending.value)}`,
  );
  expect(response.status).toBe(200);
  expect(response.cookies.get("vantara-vantara")?.value).toBe("access");
  expect(response.cookies.get("vantara-vantara-challenge")?.value).toBe("");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    email: member.email,
    session: "private-session",
    newPassword: "Replacement123!",
  });
});

it.each([
  undefined,
  "vantara-vantara-challenge=invalid",
  "vantara-vantara-challenge=null",
])("rejects absent or malformed challenge cookies", async (cookie) => {
  expect(
    (
      await signin(
        "signin/password",
        { newPassword: "Replacement123!" },
        cookie,
      )
    ).status,
  ).toBe(401);
});

it("validates replacement passwords before calling Cognito", async () => {
  expect(
    (await signin("signin/password", { newPassword: "short" })).status,
  ).toBe(400);
});
