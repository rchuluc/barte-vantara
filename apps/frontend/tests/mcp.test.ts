// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { POST, GET, DELETE } from "@/app/api/mcp/route";
import { GET as metadata } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { GET as rootMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { ApiError } from "@/lib/contracts";
import { importer, job, unitId } from "./import-fixtures";
import { tenantId } from "./fixtures";

const mocks = vi.hoisted(() => ({
  backend: vi.fn(),
  extract: vi.fn(),
  keys: vi.fn(),
}));
vi.mock("@/services/backend", () => ({ backend: mocks.backend }));
vi.mock("@/services/unstructured-extraction", () => ({
  extractUnstructured: mocks.extract,
}));
vi.mock("jose", async (original) => ({
  ...(await original<typeof import("jose")>()),
  createRemoteJWKSet: () => mocks.keys,
}));

const issuer = "https://cognito-idp.us-east-1.amazonaws.com/test";
const origin = "https://vantara.com.br";
const resource = `${origin}/api/mcp`;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let token: string;

async function sign(claims: Record<string, unknown> = {}) {
  return new SignJWT({
    iss: issuer,
    sub: "user-subject",
    aud: resource,
    exp: Math.floor(Date.now() / 1000) + 900,
    client_id: "mcp-client",
    token_use: "access",
    scope: "openid email",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(pair.privateKey);
}

function request(
  body: unknown,
  options: {
    token?: string;
    method?: string;
    headers?: Record<string, string>;
    host?: string;
  } = {},
) {
  const method = options.method ?? "POST";
  return new Request(`https://${options.host ?? "vantara.com.br"}/api/mcp`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${options.token ?? token}`,
      "MCP-Protocol-Version": "2025-11-25",
      ...options.headers,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

const rpc = (method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params,
});
const call = (name: string, args: unknown = {}) =>
  POST(request(rpc("tools/call", { name, arguments: args })));
const input = {
  unitId,
  currency: "BRL",
  rows: [
    {
      sourceMessageNumber: 1,
      party_name: "Acme",
      document_ref: "0001",
      due_on: "2026-12-01",
      amount: "12.50",
    },
  ],
  sources: ["Original invoice 0001"],
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
};

beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  const key = await exportJWK(pair.publicKey);
  mocks.keys.mockImplementation(
    createLocalJWKSet({ keys: [{ ...key, kid: "test-key", alg: "RS256" }] }),
  );
});

beforeEach(async () => {
  vi.stubEnv("COGNITO_ISSUER", issuer);
  vi.stubEnv("COGNITO_MCP_CLIENT_ID", "mcp-client");
  token = await sign();
  mocks.extract
    .mockReset()
    .mockResolvedValue({ status: "succeeded", parsed: { facts: [] } });
  mocks.backend.mockReset().mockImplementation(async (path: string) => {
    if (path === "tenants")
      return [
        {
          id: tenantId,
          slug: "vantara",
          name: "Vantara",
          primary: "#175C4C",
          domains: ["vantara.com.br", "other.com.br"],
        },
      ];
    if (path === "me") return { ...importer, actorKind: "ai" };
    if (path === "business-units") return [{ id: unitId, name: "Main" }];
    if (path.startsWith("imports?")) return { ...job, state: "uploading" };
    if (path.endsWith("/prepare")) return job;
    if (path.endsWith("/confirm")) return { ...job, state: "processing" };
    return { ...job, state: "completed", processed: 1, rejected: 0 };
  });
});

afterEach(() => vi.unstubAllEnvs());

it("discovers OIDC and challenges missing bearer credentials without accepting platform cookies", async () => {
  for (const handler of [metadata, rootMetadata]) {
    const response = await handler(new Request(resource));
    expect(await response.json()).toMatchObject({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ["openid", "email"],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  const response = await POST(
    request(rpc("tools/list"), {
      headers: { Authorization: "", Cookie: `vantara-vantara=${token}` },
    }),
  );
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain(
    `${origin}/.well-known/oauth-protected-resource/api/mcp`,
  );
  expect(mocks.backend.mock.calls.every(([path]) => path === "tenants")).toBe(
    true,
  );
});

it.each([
  { exp: 1 },
  { exp: undefined },
  { sub: "" },
  { iss: "https://attacker.test" },
  { aud: "https://other.com.br/api/mcp" },
  { aud: [resource, "other"] },
  { client_id: "web-client" },
  { token_use: "id" },
  { scope: "email" },
  { scope: 1 },
])(
  "rejects invalid token claims %j before contacting the authenticated backend",
  async (claims) => {
    const response = await POST(
      request(rpc("tools/list"), { token: await sign(claims) }),
    );
    expect(response.status).toBe(401);
    expect(mocks.backend.mock.calls.every(([path]) => path === "tenants")).toBe(
      true,
    );
  },
);

it("rejects forged signatures and malformed/oversized credentials", async () => {
  const rogue = await generateKeyPair("RS256");
  const forged = await new SignJWT({ iss: issuer, aud: resource })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(rogue.privateKey);
  for (const value of [forged, "not-a-jwt", "x".repeat(16385)]) {
    expect(
      (await POST(request(rpc("tools/list"), { token: value }))).status,
    ).toBe(401);
  }
});

it("initializes a real stateless MCP transport and lists role-authorized tools", async () => {
  const response = await POST(
    request(
      rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
    ),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    result: {
      serverInfo: { name: "vantara-imports" },
      capabilities: { tools: {} },
    },
  });
  expect(response.headers.has("mcp-session-id")).toBe(false);
  const listed = await (await POST(request(rpc("tools/list")))).json();
  expect(
    listed.result.tools.map((tool: { name: string }) => tool.name),
  ).toEqual([
    "getIdentity",
    "listImports",
    "listBankEntries",
    "listTitles",
    "listReconciliations",
    "getFinancialDetails",
    "findMatchCandidates",
    "listBusinessUnits",
    "extractEvidence",
    "createImport",
    "getImport",
  ]);
});

it("preserves identity and rereads changed roles on the next request", async () => {
  const identity = await (await call("getIdentity")).json();
  expect(JSON.parse(identity.result.content[0].text)).toMatchObject({
    roles: importer.roles,
    actorKind: "ai",
    tenant_id: tenantId,
  });
  mocks.backend.mockImplementation(async (path: string) =>
    path === "tenants"
      ? [{ id: tenantId, slug: "vantara", domains: ["vantara.com.br"] }]
      : { ...importer, actorKind: "ai", permissions: [] },
  );
  const listed = await (await POST(request(rpc("tools/list")))).json();
  expect(
    listed.result.tools.map((tool: { name: string }) => tool.name),
  ).toEqual(["getIdentity"]);
  expect((await (await call("createImport", input)).json()).error.code).toBe(
    -32602,
  );
  expect(
    mocks.backend.mock.calls.some(([path]) => path.startsWith("imports")),
  ).toBe(false);
});

it("lists scoped imports using bounded search filters", async () => {
  const original = mocks.backend.getMockImplementation()!;
  mocks.backend.mockImplementation((path, ...args) =>
    path === "imports?name=invoice&from=2026-01-01&limit=10"
      ? Promise.resolve([job])
      : original(path, ...args),
  );
  const response = await (
    await call("listImports", {
      name: "invoice",
      from: "2026-01-01",
      limit: 10,
    })
  ).json();
  expect(response.result.isError).not.toBe(true);
  expect(JSON.parse(response.result.content[0].text)).toEqual([job]);
  for (const args of [
    { limit: 101 },
    { offset: -1 },
    { from: "yesterday" },
    { approval: true },
  ]) {
    expect(
      (await (await call("listImports", args)).json()).result.isError,
    ).toBe(true);
  }
});

it("lets receivable importers read imports and destinations without payable creation tools", async () => {
  const original = mocks.backend.getMockImplementation()!;
  mocks.backend.mockImplementation((path, ...args) =>
    path === "me"
      ? Promise.resolve({
          ...importer,
          actorKind: "ai",
          permissions: ["draft_receivable"],
        })
      : original(path, ...args),
  );
  const listed = await (await POST(request(rpc("tools/list")))).json();
  const names = listed.result.tools.map((tool: { name: string }) => tool.name);
  expect(names).toEqual(
    expect.arrayContaining(["listImports", "getImport", "listBusinessUnits"]),
  );
  expect(names).not.toContain("createImport");
  expect(names).not.toContain("proposeReconciliation");
  expect(
    (await (await call("getImport", { id: job.id })).json()).result.isError,
  ).not.toBe(true);
});

it("exposes scoped financial reads and creates only pending proposals for reconcilers", async () => {
  const original = mocks.backend.getMockImplementation()!;
  mocks.backend.mockImplementation((path, ...args) => {
    if (path === "me")
      return Promise.resolve({
        ...importer,
        actorKind: "ai",
        permissions: ["propose_match"],
      });
    if (path.startsWith("reconciliation/search/")) return Promise.resolve([]);
    if (path === `reconciliation/${unitId}`)
      return Promise.resolve({ id: input.idempotencyKey });
    return original(path, ...args);
  });
  const listed = await (await POST(request(rpc("tools/list")))).json();
  const names = listed.result.tools.map((tool: { name: string }) => tool.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "listBankEntries",
      "listTitles",
      "listReconciliations",
      "getFinancialDetails",
      "findMatchCandidates",
      "proposeReconciliation",
    ]),
  );
  expect(
    names.some((name: string) => /approve|review|confirm/i.test(name)),
  ).toBe(false);
  for (const name of ["listBankEntries", "listTitles", "listReconciliations"]) {
    expect(
      JSON.parse((await (await call(name)).json()).result.content[0].text),
    ).toEqual([]);
  }
  expect(
    JSON.parse(
      (
        await (
          await call("findMatchCandidates", {
            bankId: unitId,
            name: "Acme",
            minAmountMinor: 1250,
          })
        ).json()
      ).result.content[0].text,
    ),
  ).toEqual([]);
  const args = {
    bankId: unitId,
    id: input.idempotencyKey,
    allocations: [{ titleId: tenantId, amountMinor: 1250 }],
  };
  const proposed = await (await call("proposeReconciliation", args)).json();
  expect(JSON.parse(proposed.result.content[0].text)).toMatchObject({
    id: input.idempotencyKey,
    approvalStatus: "pending",
    reviewPath: "/vantara/reconciliation",
  });
  expect(mocks.backend).toHaveBeenCalledWith(
    `reconciliation/${unitId}`,
    expect.anything(),
    expect.objectContaining({
      method: "POST",
      token,
      tenantId,
      body: {
        id: input.idempotencyKey,
        action: "draft",
        allocations: args.allocations,
      },
    }),
  );
  for (const extra of [
    { action: "confirmed" },
    { origin: "human" },
    { allocations: [] },
  ]) {
    expect(
      (
        await (
          await call("proposeReconciliation", { ...args, ...extra })
        ).json()
      ).result.isError,
    ).toBe(true);
  }
});

it.each([
  { active: false },
  { tenant_id: "other-tenant" },
  { actorKind: "human" },
])(
  "denies inactive, cross-tenant or non-delegated membership %j",
  async (override) => {
    mocks.backend
      .mockResolvedValueOnce([{ id: tenantId, domains: ["vantara.com.br"] }])
      .mockResolvedValueOnce({ ...importer, actorKind: "ai", ...override });
    expect((await POST(request(rpc("tools/list")))).status).toBe(403);
  },
);

it("uses the actual platform upload/prepare/confirm/process pipeline with the delegated token and stable retries", async () => {
  const response = await (await call("createImport", input)).json();
  expect(JSON.parse(response.result.content[0].text)).toMatchObject({
    processed: 1,
    rejected: 0,
    state: "completed",
  });
  const upload = mocks.backend.mock.calls.find(([path]) =>
    path.startsWith("imports?"),
  )!;
  expect(new TextDecoder().decode(upload[2].rawBody)).toContain(
    '"0001","2026-12-01","12.50"',
  );
  const writes = mocks.backend.mock.calls.filter(([path]) =>
    path.startsWith("imports"),
  );
  expect(writes.map(([path]) => path)).toEqual([
    expect.stringContaining("imports?"),
    expect.stringMatching(/\/prepare$/),
    expect.stringMatching(/\/confirm$/),
    expect.stringMatching(/\/process$/),
  ]);
  for (const [, , options] of writes)
    expect(options).toMatchObject({ token, tenantId, method: "POST" });
  await call("createImport", input);
  const uploads = mocks.backend.mock.calls.filter(([path]) =>
    path.startsWith("imports?"),
  );
  expect(uploads[0][2].idempotencyKey).toBe(uploads[1][2].idempotencyKey);
});

it("exposes allowed units, extraction and import status", async () => {
  expect(
    JSON.parse(
      (await (await call("listBusinessUnits")).json()).result.content[0].text,
    ),
  ).toEqual([{ id: unitId, name: "Main" }]);
  expect(
    JSON.parse(
      (
        await (
          await call("extractEvidence", { source: " original source " })
        ).json()
      ).result.content[0].text,
    ),
  ).toMatchObject({ status: "succeeded" });
  expect(mocks.extract).toHaveBeenCalledWith(
    " original source ",
    expect.any(AbortSignal),
  );
  expect(
    JSON.parse(
      (await (await call("getImport", { id: job.id })).json()).result.content[0]
        .text,
    ),
  ).toMatchObject({ id: job.id, processed: 1 });
});

it("rejects unauthorized units and malformed input without saving", async () => {
  for (const args of [
    { ...input, unitId: "invalid" },
    { ...input, role: "admin" },
    { ...input, sources: [] },
    { ...input, sources: [" "] },
    { ...input, rows: [{ ...input.rows[0], sourceMessageNumber: 2 }] },
  ]) {
    expect(
      (await (await call("createImport", args)).json()).result.isError,
    ).toBe(true);
  }
  mocks.backend
    .mockResolvedValueOnce([{ id: tenantId, domains: ["vantara.com.br"] }])
    .mockResolvedValueOnce({ ...importer, actorKind: "ai" })
    .mockResolvedValueOnce([]);
  expect(
    (await (await call("createImport", input)).json()).result.isError,
  ).toBe(true);
  expect(
    mocks.backend.mock.calls.some(([path]) => path.startsWith("imports")),
  ).toBe(false);
});

it("rejects unknown hosts, other workspace audiences and cross-origin requests", async () => {
  expect(
    (await POST(request(rpc("tools/list"), { host: "unknown.test" }))).status,
  ).toBe(404);
  expect(
    (await POST(request(rpc("tools/list"), { host: "other.com.br" }))).status,
  ).toBe(401);
  expect(
    (
      await POST(
        request(rpc("tools/list"), {
          headers: { Origin: "https://evil.test" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await POST(request(rpc("tools/list"), { headers: { Origin: origin } })))
      .status,
  ).toBe(200);
});

it("limits request bodies and rejects malformed JSON", async () => {
  expect((await POST(request({ text: "x".repeat(262144) }))).status).toBe(413);
  const malformed = request({});
  expect((await POST(new Request(malformed, { body: "{" }))).status).toBe(400);
  expect((await POST(new Request(malformed, { body: "" }))).status).toBe(400);
  expect(
    (
      await POST(
        new Request(resource, { method: "POST", headers: malformed.headers }),
      )
    ).status,
  ).toBe(400);
});

it("does not create persistent GET/DELETE sessions and accepts notifications", async () => {
  for (const [handler, method] of [
    [GET, "GET"],
    [DELETE, "DELETE"],
  ] as const) {
    const response = await handler(request(null, { method }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  }
  expect(
    (
      await POST(
        request({ jsonrpc: "2.0", method: "notifications/initialized" }),
      )
    ).status,
  ).toBe(202);
});

it("fails closed without OIDC configuration and sanitizes infrastructure failures", async () => {
  for (const config of ["", "http://issuer.test", "not-a-url"]) {
    vi.stubEnv("COGNITO_ISSUER", config);
    expect((await metadata(new Request(resource))).status).toBe(503);
    expect((await POST(request(rpc("tools/list")))).status).toBe(503);
  }
  vi.stubEnv("COGNITO_ISSUER", issuer);
  vi.stubEnv("COGNITO_MCP_CLIENT_ID", "");
  expect((await POST(request(rpc("tools/list")))).status).toBe(503);
  vi.stubEnv("COGNITO_MCP_CLIENT_ID", "mcp-client");
  mocks.backend.mockRejectedValueOnce(new Error("private connection secret"));
  const response = await POST(request(rpc("tools/list")));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private connection secret");
  mocks.backend
    .mockResolvedValueOnce([{ id: tenantId, domains: ["vantara.com.br"] }])
    .mockRejectedValueOnce(new ApiError(401, "expired"));
  expect((await POST(request(rpc("tools/list")))).status).toBe(401);
});

it("sanitizes tool failures without reporting an import success", async () => {
  mocks.extract.mockRejectedValueOnce(new Error("private provider credential"));
  const extraction = await (
    await call("extractEvidence", { source: "Invoice" })
  ).json();
  expect(extraction.result.isError).toBe(true);
  expect(JSON.stringify(extraction)).not.toContain(
    "private provider credential",
  );

  mocks.backend
    .mockResolvedValueOnce([{ id: tenantId, domains: ["vantara.com.br"] }])
    .mockResolvedValueOnce({ ...importer, actorKind: "ai" })
    .mockResolvedValueOnce([{ id: unitId }])
    .mockRejectedValueOnce(new ApiError(503, "private upstream failure"));
  const imported = await (await call("createImport", input)).json();
  expect(imported.result.isError).toBe(true);
  expect(JSON.stringify(imported)).not.toContain("private upstream failure");
  expect(
    mocks.backend.mock.calls.some(([path]) => path.endsWith("/process")),
  ).toBe(false);
});

it("uses the validated external authority and rejects malformed Host headers", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const response = await metadata(
    new Request("http://internal:3000/api/mcp", {
      headers: { Host: "VANTARA.COM.BR" },
    }),
  );
  expect(await response.json()).toMatchObject({ resource });
  expect(
    (
      await metadata(
        new Request(resource, {
          headers: { Host: "vantara.com.br:443@evil.test" },
        }),
      )
    ).status,
  ).toBe(400);
});
