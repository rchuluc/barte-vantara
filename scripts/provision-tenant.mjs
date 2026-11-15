import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

export function payload(env) {
  const tenant = {
    id: randomUUID(),
    name: (env.TENANT_NAME ?? "").trim(),
    slug: (env.TENANT_SLUG ?? "").trim(),
    primary: (env.TENANT_PRIMARY ?? "").trim(),
    domains: (env.TENANT_DOMAINS ?? "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase()),
  };
  const firstUserEmail = (env.FIRST_USER_EMAIL ?? "").trim();
  if (
    !/^[a-z][a-z0-9-]{0,62}$/.test(tenant.slug) ||
    !tenant.name.trim() ||
    tenant.name.length > 100 ||
    !/^#[0-9a-f]{6}$/i.test(tenant.primary) ||
    tenant.domains.length < 1 ||
    tenant.domains.length > 20 ||
    tenant.domains.some(
      (domain) =>
        domain.length > 253 || !/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(domain),
    ) ||
    new Set(tenant.domains).size !== tenant.domains.length ||
    firstUserEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(firstUserEmail)
  ) {
    throw new Error(
      "Provide a tenant name, valid lowercase slug, #RRGGBB color, comma-separated unique hostnames, and administrator email.",
    );
  }
  return { tenant, firstUserEmail };
}

export async function provision(env, request = fetch) {
  const body = payload(env);
  const url = new URL(env.APP_URL);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("APP_URL must be an HTTPS origin.");
  }
  const oidc = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  oidc.searchParams.set("audience", "vantara-tenant-provisioning");
  const identity = await request(oidc, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!identity.ok)
    throw new Error(`GitHub identity request failed (${identity.status}).`);
  const token = await identity.json();
  if (typeof token.value !== "string" || !token.value)
    throw new Error("GitHub returned no identity token.");

  const response = await request(new URL("/api/admin/tenants", url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.value}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (response.status !== 201)
    throw new Error(
      `Tenant registration failed (${response.status}). Check for existing registration before retrying.`,
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await provision(process.env);
    console.log(
      "Tenant registered. Cognito has been asked to email the first administrator's invitation.",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Tenant registration failed.",
    );
    process.exitCode = 1;
  }
}
