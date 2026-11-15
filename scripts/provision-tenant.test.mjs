import assert from "node:assert/strict";
import { test } from "node:test";
import { payload, provision } from "./provision-tenant.mjs";

const tenant = {
  id: "ce19c2fb-b199-4b58-a274-113cd07ce416",
  slug: "acme",
  name: "Acme",
  primary: "#112233",
  domains: ["acme.test"],
};
const env = {
  TENANT_NAME: tenant.name,
  TENANT_SLUG: tenant.slug,
  TENANT_PRIMARY: tenant.primary,
  TENANT_DOMAINS: tenant.domains.join(", "),
  FIRST_USER_EMAIL: "admin@example.com",
  APP_URL: "https://app.example.com",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://github.example/token?request=1",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token",
};

test("validates inputs and requests the scoped OIDC token before provisioning", async () => {
  const calls = [];
  await provision(env, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? Response.json({ value: "github-token" })
      : new Response(null, { status: 201 });
  });
  assert.equal(
    calls[0].url.searchParams.get("audience"),
    "vantara-tenant-provisioning",
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer runner-token");
  assert.equal(
    String(calls[1].url),
    "https://app.example.com/api/admin/tenants",
  );
  assert.equal(calls[1].options.headers.Authorization, "Bearer github-token");
  assert.equal(calls[1].options.redirect, "error");
  const body = JSON.parse(calls[1].options.body);
  assert.match(
    body.tenant.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(body, {
    tenant: { ...tenant, id: body.tenant.id },
    firstUserEmail: env.FIRST_USER_EMAIL,
  });
});

test("rejects malformed tenant inputs and email", () => {
  for (const invalid of [
    {},
    { ...env, TENANT_SLUG: "UPPER" },
    { ...env, TENANT_SLUG: undefined },
    { ...env, TENANT_NAME: " " },
    { ...env, TENANT_PRIMARY: "red" },
    { ...env, TENANT_DOMAINS: "" },
    { ...env, TENANT_DOMAINS: "https://acme.test" },
    { ...env, TENANT_DOMAINS: "evil/path" },
    { ...env, TENANT_DOMAINS: "acme.test, ACME.test" },
    { ...env, TENANT_DOMAINS: "acme.test," },
    { ...env, FIRST_USER_EMAIL: "bad" },
  ]) {
    assert.throws(() => payload(invalid));
  }
});

test("builds JSON safely from operator fields and always generates a new ID", () => {
  const first = payload({
    ...env,
    TENANT_ID: "operator-id",
    TENANT_NAME: ' Acme "Finance" ',
    TENANT_DOMAINS: " ACME.test, portal.acme.test ",
    FIRST_USER_EMAIL: " admin@example.com ",
  });
  assert.notEqual(first.tenant.id, "operator-id");
  assert.notEqual(first.tenant.id, payload(env).tenant.id);
  assert.equal(first.tenant.name, 'Acme "Finance"');
  assert.deepEqual(first.tenant.domains, ["acme.test", "portal.acme.test"]);
  assert.equal(first.firstUserEmail, "admin@example.com");
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
});

test("rejects non-origin destinations before sending credentials", async () => {
  for (const APP_URL of [
    "http://app.example.com",
    "https://user:pass@app.example.com",
    "https://app.example.com/path",
    "https://app.example.com/?q=1",
    "https://app.example.com/#fragment",
  ]) {
    await assert.rejects(
      provision({ ...env, APP_URL }, () => assert.fail("must not fetch")),
      /HTTPS origin/,
    );
  }
});

test("reports identity and provisioning failures without exposing response bodies", async () => {
  await assert.rejects(
    provision(env, async () => new Response("secret", { status: 403 })),
    /identity request failed \(403\)/,
  );
  await assert.rejects(
    provision(env, async () => Response.json({})),
    /no identity token/,
  );
  let count = 0;
  await assert.rejects(
    provision(env, async () =>
      ++count === 1
        ? Response.json({ value: "private" })
        : new Response("private", { status: 409 }),
    ),
    /registration failed \(409\)/,
  );
});
