import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";

// Explicit local-only integration check against the running Next app and seeded backend.
const origin = process.env.SMOKE_ORIGIN ?? "http://localhost:3217";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
assert.equal(new URL(origin).protocol, "http:");
const tenantOrigin = new URL(origin);
tenantOrigin.hostname = "vantara.localhost";
const password = process.env.SMOKE_PASSWORD ?? "@Test123";
let cookie = "";

async function request(path, method = "GET", body, expected = 200) {
  // Node fetch replaces Host; use HTTP directly to exercise subdomain routing on loopback.
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `${origin}/api/${path}`,
      {
        method,
        headers: {
          origin: tenantOrigin.origin,
          host: tenantOrigin.host,
          cookie,
          "Content-Type": "application/json",
        },
      },
      async (res) => {
        try {
          const chunks = [];
          for await (const chunk of res) chunks.push(chunk);
          const headers = new Headers();
          for (const [name, values] of Object.entries(res.headers)) {
            for (const value of [values].flat()) {
              if (value !== undefined) headers.append(name, value);
            }
          }
          resolve(
            new Response(
              res.statusCode === 204 ? null : Buffer.concat(chunks),
              {
                status: res.statusCode,
                headers,
              },
            ),
          );
        } catch (error) {
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("Request timed out")));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${await response.clone().text()}`,
  );
  const session = response.headers.get("set-cookie");
  if (session) cookie = session.split(";")[0];
  return expected === 204 ? null : response.json();
}

await request("me", "GET", undefined, 401);
const admin = await request("signin", "POST", {
  email: "admin@vantara.com.br",
  password,
});
assert.ok(admin.permissions.includes("configure"));
assert.equal((await request("me")).id, admin.id);
assert.ok((await request("users/roles")).some(({ role }) => role === "ap"));
assert.ok((await request("users?limit=20&offset=0")).length >= 6);
await request(`users/${admin.id}`, "PATCH", { active: false }, 403);

let created;
try {
  created = await request(
    "users",
    "POST",
    {
      email: `frontend-smoke-${Date.now()}@example.com`,
      password: "SmokeCheck123!",
      displayName: "Frontend smoke test",
      roles: ["ap"],
      unitIds: [],
      bankAccountIds: [],
    },
    201,
  );
  assert.equal(
    (
      await request(`users/${created.id}`, "PATCH", {
        displayName: "Verified frontend",
        roles: ["ar"],
      })
    ).display_name,
    "Verified frontend",
  );
  await request(`users/${created.id}`, "DELETE", undefined, 204);
  assert.equal(
    (await request(`users/${created.id}`, "PATCH", { active: true })).active,
    true,
  );
} finally {
  // The API uses soft deletion; the local test account remains inactive for auditability.
  if (created) await request(`users/${created.id}`, "DELETE", undefined, 204);
}

await request("logout", "POST", undefined, 204);
await request("me", "GET", undefined, 401);
const member = await request("signin", "POST", {
  email: "ap@vantara.com.br",
  password,
});
assert.equal(member.email, "ap@vantara.com.br");
assert.ok(!member.permissions.includes("configure"));
await request("users", "GET", undefined, 403);
await request("logout", "POST", undefined, 204);
console.log(
  "Live smoke passed: signin, identity, admin CRUD, self-admin denial, member denial, logout.",
);
