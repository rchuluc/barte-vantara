import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { payload } from "./provision-tenant.mjs";

export function seedArguments(env) {
  const { tenant, firstUserEmail } = payload(env);
  return [
    "compose",
    "-f",
    fileURLToPath(new URL("../compose.yml", import.meta.url)),
    "run",
    "--rm",
    "seed",
    "--spring.profiles.active=seed",
    `--seed.tenant-id=${tenant.id}`,
    `--seed.tenant-slug=${tenant.slug}`,
    `--seed.tenant-name=${tenant.name}`,
    `--seed.tenant-primary=${tenant.primary}`,
    `--seed.tenant-domains=${tenant.domains.join(",")}`,
    `--seed.admin-email=${firstUserEmail}`,
  ];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const prompts = {
    name: ["TENANT_NAME", "Display name (e.g. Acme Finance): "],
    slug: ["TENANT_SLUG", "URL slug (e.g. acme): "],
    primary: ["TENANT_PRIMARY", "Brand color (e.g. #175C4C): "],
    domains: [
      "TENANT_DOMAINS",
      "Hostnames, comma-separated (e.g. acme.localhost): ",
    ],
    email: ["FIRST_USER_EMAIL", "Administrator email (e.g. admin@acme.test): "],
  };
  let input;
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(
        Object.keys(prompts).map((key) => [key, { type: "string" }]),
      ),
    });
    const env = {};
    for (const [key, [variable, prompt]] of Object.entries(prompts)) {
      if (!values[key] && !process.stdin.isTTY)
        throw new Error(
          `Missing --${key}. Run interactively or provide all five options.`,
        );
      if (!values[key])
        input ??= createInterface({
          input: process.stdin,
          output: process.stdout,
        });
      env[variable] = values[key] ?? (await input.question(prompt));
    }
    input?.close();
    const result = spawnSync("docker", seedArguments(env), {
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        "Local tenant seed failed. Check the Compose logs and existing registrations before retrying.",
      );
    console.log(
      `Local tenant created. Sign in at http://localhost:3000/${env.TENANT_SLUG.trim()}/login (use your dev server's port if different). Administrator password: @Test123`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Local tenant seed failed.",
    );
    process.exitCode = 1;
  } finally {
    input?.close();
  }
}
