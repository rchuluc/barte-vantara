# MCP imports

Connect a remote Streamable HTTP MCP client to `https://<workspace-host>/api/mcp`.
The host must be one of the workspace's registered domains. The adapter uses the
same payable import service as the platform assistant: original evidence is
preserved in CSV, then uploaded, prepared, mapped and processed by the backend.
Imports appear in the platform's import history with actual processed/rejected
counts. This first tool surface handles the assistant's text-to-payables flow;
CSV/XLSX file upload remains in the platform.

## OIDC setup

### Local verification without hosted login

Local checks use the existing emulator without extending it or relaxing the
MCP's token checks:

```sh
cd apps/frontend
npx vitest run tests/mcp.test.ts tests/assistant-import.test.ts
SMOKE_ORIGIN=http://localhost:3217 npm run test:smoke
```

The MCP tests exercise the real HTTP transport and JWT signature/claim validation
with generated test keys; backend responses are mocked. The live smoke test
checks platform login, current identity, import history, business units and
authorization against the running local services. It creates a temporary user
and leaves that user inactive for auditability.

Run the backend integration tests separately to verify import persistence,
original evidence, retries, delegated roles and database scope restrictions in
real PostgreSQL and Floci containers:

```sh
cd apps/backend
DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')" \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
./gradlew test --tests com.barte.vantara.UserManagementTests --no-daemon
```

These checks cover the adapter and shared import pipeline, not a complete
OpenCode-to-Cognito browser login. Verify discovery, PKCE, resource binding,
refresh and an actual import together after deployment with real Cognito.
Floci 2.3.0 does not implement the OAuth `resource` parameter, so its login
tokens cannot authenticate this MCP endpoint. There is no local auth bypass.

### Deployed Cognito connection

1. Set Terraform `mcp_callback_urls` to the **MCP client's exact HTTPS or local loopback callback
   URLs**. The existing identity module creates a public Cognito client with
   authorization-code flow and a hosted login domain. Apply through the normal
   infrastructure workflow.
2. Configure the MCP client with the `cognito_mcp_client_id` Terraform output.
   Cognito does not provide dynamic client registration; use a client supporting
   pre-registered OAuth client IDs. No client secret is required.
3. Frontend runtime settings are `COGNITO_ISSUER` and `COGNITO_MCP_CLIENT_ID`;
   Terraform supplies both. The backend must use the same values. An empty MCP
   client ID disables the endpoint (503), without affecting the platform login.
4. The MCP client discovers protected-resource metadata from the 401
   `WWW-Authenticate` header or
   `/.well-known/oauth-protected-resource/api/mcp`. The root protected-resource
   metadata URL is also available. It discovers Cognito's authorization/token
   endpoints from the issuer's `/.well-known/openid-configuration`.
5. The client opens Cognito login with `response_type=code`, `scope=openid email`,
   PKCE S256, state and OIDC nonce, its registered redirect URI, and
   **`resource=https://<workspace-host>/api/mcp`**. It validates callback state and
   OIDC nonce and exchanges the code with its PKCE verifier. Send the resulting
   **access token**, not the ID token, as `Authorization: Bearer ...`.
6. The MCP client securely retains and refreshes its tokens through Cognito.
   Resource binding must remain intact on refreshed tokens; otherwise log in
   again. Tokens expire after 15 minutes; the configured refresh lifetime is one
   day. There is no shared server-side MCP login session or browser-cookie login.

Use the public HTTPS workspace URL, not an internal service hostname. The
frontend validates JWT signature, issuer, expiry, exact resource audience,
dedicated client ID, access-token use and `openid` scope. Web-client tokens and
tokens for other workspace URLs are rejected. Local Floci seed login does not
configure this hosted OIDC flow; test it against an explicitly configured pool.

## Tools and authorization

For OpenCode V2, register `http://127.0.0.1:19876/callback` and configure:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "vantara": {
        "type": "remote",
        "url": "https://<workspace-host>/api/mcp",
        "oauth": {
          "client_id": "<cognito_mcp_client_id>",
          "scope": "openid email",
          "callback_port": 19876,
          "redirect_uri": "http://127.0.0.1:19876/callback"
        }
      }
    }
  }
}
```

Use `/mcps`, select `vantara`, and sign in with the existing workspace user.
The callback is local to the OpenCode machine; the MCP and Cognito endpoints
remain HTTPS. Tokens are stored by OpenCode, not in the project config.

- `getIdentity`: current signed-in user, roles, effective permissions and scopes.
- `listBusinessUnits`: permitted destinations.
- `extractEvidence`: extract facts from original invoice/email text without saving.
- `createImport`: save open payables; pass the shared assistant input (`unitId`,
  `currency`, `rows`), `sources` (original texts indexed from 1 by each row's
  `sourceMessageNumber`), and a UUID `idempotencyKey`. Reuse the exact input/key
  on retries. Keys are namespaced to the user and workspace.
- `getImport`: inspect the resulting import state.

Import tools are advertised only when the current user has `draft_payable`.
The backend revalidates identity, active tenant membership, role and unit scope
on every operation, with PostgreSQL RLS enforcing access. Roles are loaded from
`/api/me` on every MCP request; they are never copied into a long-lived session
or supplied by tool arguments. The delegated client keeps `actorKind=ai`, so it
cannot acquire human payment-approval/reconciliation-confirmation authority.

Configure the MCP host to require human approval for `createImport`, displaying
the rows and destination before invocation. This is the client's tool approval,
not the platform chat's signed approval button; the endpoint does not claim to
have verified a platform UI approval. Importing creates open records, never
approves or pays invoices.

Requests are stateless, bounded to 256 KiB, and return JSON MCP responses.
Authenticated GET/DELETE return 405: there is no persistent SSE session to resume
or delete. Credentials are accepted only in the Authorization header. Browser
origins other than the workspace origin are rejected; native/desktop clients
may omit Origin.
