import assert from "node:assert/strict";

// Explicit local-only integration check against the running Next app and seeded backend.
const origin = process.env.SMOKE_ORIGIN ?? "http://localhost:3217";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const password = process.env.SMOKE_PASSWORD ?? "@Test123";
let cookie = "";

async function request(path, method = "GET", body, expected = 200) {
  const response = await fetch(`${origin}/api/vantara/${path}`, {
    method,
    headers: { origin, cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
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
