import assert from "node:assert/strict";
import { test } from "node:test";
import { seedArguments } from "./add-dev-tenant.mjs";

const env = {
  TENANT_NAME: 'Acme "Finance"',
  TENANT_SLUG: "acme",
  TENANT_PRIMARY: "#112233",
  TENANT_DOMAINS: "ACME.localhost, portal.acme.test",
  FIRST_USER_EMAIL: "admin@acme.test",
};

test("local tenant creation uses the fixed Compose seed and generated ID with safely separated arguments", () => {
  const args = seedArguments(env);
  assert.deepEqual(args.slice(0, 2), ["compose", "-f"]);
  assert.ok(args[2].endsWith("/compose.yml"));
  assert.deepEqual(args.slice(3, 7), [
    "run",
    "--rm",
    "seed",
    "--spring.profiles.active=seed",
  ]);
  assert.ok(args.includes('--seed.tenant-name=Acme "Finance"'));
  assert.ok(
    args.includes("--seed.tenant-domains=acme.localhost,portal.acme.test"),
  );
  assert.ok(args.includes("--seed.admin-email=admin@acme.test"));
  assert.notEqual(args[7], seedArguments(env)[7]);
});

test("invalid local tenant input is rejected before Docker is invoked", () => {
  assert.throws(() => seedArguments({ ...env, TENANT_SLUG: "bad/path" }));
  assert.throws(() => seedArguments({ ...env, FIRST_USER_EMAIL: "bad" }));
});
