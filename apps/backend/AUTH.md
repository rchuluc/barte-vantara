# Identity and user management

Cognito verifies identity; PostgreSQL is the authority for memberships, roles,
business units, bank accounts and independent approval grants. Cognito groups and
caller-supplied role/tenant/principal-kind claims do not confer access.

## HTTP contract

Use `Authorization: Bearer <accessToken>`. ID tokens are rejected. JWT verification
requires RS256 signature, issuer, expiry, `token_use=access`, an allowed client ID
and a nonblank subject. Every authorized operation resolves the active membership
and installs transaction-local database context. Role changes/deactivation take
effect on the next request, including for already-issued tokens.

`X-Tenant-Id` selects an **existing active membership**, never grants one. It is
optional for a single membership and required when more than one is active.

| Method | Path | Access | Result |
| --- | --- | --- | --- |
| POST | `/api/signin` | Public | 200, tokens; `Cache-Control: no-store` |
| GET | `/api/me` | Active member | Identity, roles, scopes, permissions, actor kind |
| POST | `/api/users` | Technical Admin | 201, created user |
| GET | `/api/users` | Technical Admin | Scoped users; `limit=50` (1–100), `offset=0` |
| GET | `/api/users/roles` | Technical Admin | Role codes and permission catalog |
| GET | `/api/users/{id}` | Technical Admin | Scoped membership |
| PATCH | `/api/users/{id}` | Technical Admin | 200, updated membership |
| DELETE | `/api/users/{id}` | Technical Admin | 204, deactivated membership |

Sign-in body: `{"email":"admin@vantara.com.br","password":"@Test123"}`.
Response: `accessToken`, `idToken`, `refreshToken`, `expiresIn`, `tokenType`.
The configured web client uses password authentication; unsupported Cognito
challenges fail closed with 401. MFA/challenge completion and refresh endpoints
are not part of these routes.

Create body:

```json
{
  "email": "operator@example.com",
  "password": "ChooseAUniquePassword123!",
  "displayName": "Operator",
  "roles": ["ap"],
  "unitIds": [],
  "bankAccountIds": []
}
```

Patch accepts optional `displayName`, `active`, `roles`, `unitIds`,
`bankAccountIds`. Provided collections replace the corresponding grants; omitted
fields remain unchanged. Explicitly remove account grants when removing their
units. Units with independent approval grants require provisioner intervention
before removal. Identity bindings/email/principal kind cannot be rewritten.
Self-administration is forbidden. Admins can manage only memberships whose entire
unit scope is within their own, and delegate only their existing account scope.

User responses contain `id`, `tenant_id`, `email`, `display_name`, `active`,
`principal_kind`, `roles`, `unitIds`, `bankAccountIds`. `/me` also includes
`actorKind`, `permissions` and `approvalScopes` (`unit_id`, `permission`).
Permissions always apply together with the returned scopes, not tenant-wide.

Delete retains membership/history and disables access in the selected tenant;
it does not destroy a shared Cognito identity or access to another tenant.
Failed creation rolls back SQL and compensates the newly created Cognito user.
If provider cleanup also fails, the orphan has no membership and cannot access
the application; remove it from Cognito before retrying that email.

Errors: 400 invalid input, 401 invalid credentials/token, 403 insufficient scope,
404 inaccessible/missing user, 409 identity conflict or dependent grants,
429 provider rate limit, 502 identity-provider failure, 503 database failure.
Provider/SQL details and passwords are not returned.

## Role and approval model

| Code / seed address | Role |
| --- | --- |
| `admin@vantara.com.br` | Technical Admin |
| `ap@vantara.com.br` | Accounts Payable |
| `ar@vantara.com.br` | Accounts Receivable & Collections |
| `reconciliation@vantara.com.br` | Reconciliation |
| `controllership@vantara.com.br` | Controllership |
| `fpa@vantara.com.br` | FP&A |

All roles are tenant- and unit-scoped. Bank rows, balances, supporting bank
evidence, allocations, reviews and raw audit payloads additionally enforce
account grants. Unclassified legacy bank evidence is hidden until scoped.
FP&A reads approved aggregates/forecasts rather than raw payments. Technical
Admin has configuration/membership rights, not financial or approval authority.
Read permission does not grant AP drafting/submission rights to Controllership.
AR can propose incoming matches; confirmations require independent human scope.

Approval grants are a separate, provisioner-managed `approval_scope`, not
assignable through user-management routes. Payment approval, reconciliation
confirmation and summary publication require a human identity and an independent
reviewer; self-approval is rejected in PostgreSQL. No funds-release action exists.

UI clients should use `/me` to gate controls and must still send the user's token
to the backend. The backend/RLS remains authoritative. An MCP adapter must use
the dedicated delegated OIDC client, authorization code + PKCE, and `UserAccess`
for transactions. Its verified client ID forces `actorKind=ai` regardless of the
human user's identity; it receives the same scopes but no human approval rights.
Do not give agents web-client bearer tokens or service-wide database credentials.
The connection/UI adapters themselves are outside this backend route increment.

## Local development

`docker compose up -d --build` runs migrations, then the explicit one-shot `seed`
profile against Floci, then starts the runtime with `/auth/cognito.properties`.
The file contains pool/client/issuer/JWKS configuration, no passwords. The seed
creates Vantara and the six users above, all with `@Test123`. It is repeatable and
does not create business units, bank accounts, financial data or approval grants.
Consequently seed users start with empty financial scope. The seed profile is
local-Floci-only and never enabled by ECS; only it uses migration credentials.

To run the backend on the host, copy `/auth/cognito.properties` from the backend
container, change only the JWKS hostname from `floci` to `localhost`, and use:

```sh
DB_PASSWORD=localRuntimeOnly COGNITO_ENDPOINT=http://localhost:4566 \
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
SPRING_CONFIG_IMPORT=file:/absolute/path/cognito.properties ./gradlew bootRun
```

Production settings: `AWS_REGION`, `COGNITO_POOL_ID`, `COGNITO_CLIENT_ID`,
`COGNITO_ISSUER`; optional `COGNITO_MCP_CLIENT_ID`. Use the default AWS credential
chain/ECS task role. `COGNITO_ENDPOINT` and `COGNITO_JWKS_URI` are local/test
overrides. Missing identity configuration rejects all bearer tokens.

## Evidence

`./gradlew check` runs real PostgreSQL 17 + Floci 2.3.0 Testcontainers, HTTP CRUD
and denial tests, seed repeatability/bootstrap, database RLS/action checks,
cross-tenant/unit/account denials, JWT tamper/issuer/client/expiry rejection,
OIDC-to-database AI approval denial and provisioning failure recovery. Existing
financial tests cover self-approval, AI impersonation, immutable evidence and
approved-only FP&A aggregates. The unchanged line/branch coverage gate is 95%.
