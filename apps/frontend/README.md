# Frontend

Next.js 16 App Router, React, strict TypeScript, Tailwind 4, shadcn/ui and
TanStack Query. Tenant-branded login, account overview, member profile, and admin
user management use the existing Cognito-backed backend APIs.

```sh
npm ci
npm run dev             # http://localhost:3000; backend defaults to :8080
npm run lint
npm run format          # Prettier formatting
npm run format:check    # required in CI and pre-commit
npm run typecheck
npm test                # Vitest behavior tests
npm run test:coverage   # 95% lines/branches/functions/statements, all src files
npm run build
npm run dev -- --port 3217 # alongside Compose's frontend on :3000
npm run test:smoke         # live HTTP integration against :3217 and seeded backend
```

Run the root Compose stack first for database/backend development. To run just
the Next.js dev server, stop the Compose frontend to free port 3000. The complete
containerized path is `docker compose up -d --build` at the repository root.

`/api/health` is a process health probe, deliberately independent of backend
availability so a backend outage does not restart every frontend task.
The root page lists configured workspaces. `/vantara/login` is the seeded entry
point; `http://vantara.localhost:3217/login` also works via hostname rewriting.

## Tenants and branding

Every environment reads persisted branding from backend `GET /api/tenants`.
There is no local JSON or environment-variable tenant configuration. The loader
in `src/lib/tenants.ts` uses uncached reads; refresh to see database changes.
Unavailable or invalid backend responses fail closed.

Set server-side `TENANT_NOT_FOUND_REDIRECT_URL` to an absolute HTTP(S) URL to
redirect browser requests with no matching tenant (307). There is no default;
unset or blank keeps unknown-tenant 404s. API routes still return JSON errors,
and backend outages are not treated as missing tenants. Valid tenant paths on
the platform host remain supported. With a redirect configured, an unmapped
host's root also redirects instead of showing the workspace selector.

Production explicitly sets `TENANT_NOT_FOUND_REDIRECT_URL=https://www.barte.com`.
Terraform supplies it through `tenant_not_found_redirect_url`; set that field in
production tfvars (including the GitHub planning environment's tfvars JSON).
For `npm run dev`, the variable can be set in `.env.local`; restart after changing it.

The Compose seed creates Vantara with primary color `#175C4C`, domains
`vantara.localhost` and `vantara.com.br`, and the existing development accounts.
Rerunning it preserves existing branding. After updating the backend code, run
`docker compose up -d --build` from the repository root to migrate and seed.

To add a local tenant, run `npm run tenant:add` **from the repository root** and
answer the prompts, or supply all fields:

```sh
npm run tenant:add -- --name "Acme Finance" --slug acme --primary '#112233' \
  --domains acme.localhost --email admin@acme.test
```

The script generates the UUID and runs the local Compose seed to create branding
and an administrator with development password `@Test123`. Open
`http://localhost:3000/acme/login` (or port 3217 for a separate dev server).
See [tenant provisioning](../../docs/tenant-provisioning.md) for production registration.

Each tenant needs a corresponding database tenant and active memberships. Slugs
and exact domain mappings must be unique; arbitrary `vantara.*` domains are not
trusted automatically. Configure DNS/TLS and your ingress for production domains.
Next's proxy rewrites mapped-domain routes into `app/[tenant]`; explicit
`/[tenant]/...` paths work on the platform host. Mapped domains cannot use another
tenant's paths or API. The name is the text logo and document title; the primary
color drives branded surfaces/actions, with automatically contrasted text.

## Data and authentication

- Components use `src/hooks/use-workspace.ts`; hooks own TanStack Query state.
- `src/services/workspace.ts` uses native fetch to same-origin Next API routes.
- Next API routes use `src/services/backend.ts` directly. `BACKEND_URL` stays
  server-only. Both boundaries validate responses and time-bound requests.
- Sign-in verifies an active membership in the selected tenant before setting a
  host-only, HttpOnly, SameSite=Lax cookie (Secure in production). Tokens are not
  returned to browser JavaScript or stored in localStorage. Sessions last for the
  access token's lifetime; there is no refresh endpoint in the current backend.
- Invited administrators enter their emailed temporary password, then choose a new
  password. The pending Cognito challenge lives in a separate three-minute HttpOnly
  cookie; membership is verified before the final session is created.
- Mutations require matching Origin/Host. Every authenticated API request verifies
  current membership; admin operations require `configure` and still pass through
  backend authorization/RLS. Client navigation visibility is not authorization.
- Query keys include the tenant; successful sign-in/logout cancel and clear caches.
  Expired sessions return to login. Logout clears this browser's tenant session.
- Member profiles are read-only because the backend currently exposes `GET /me`.
  Admins can create users, edit names/roles/unit/account UUID scopes, deactivate and
  reactivate users. Self-administration is denied. Deactivation is a soft delete.

## Verification

Unit/component tests cover routing/branding, cookies, CSRF, authorization, malformed
responses, request failures, loading states and user interactions. Coverage includes
every source file with the unchanged 95% gates.

`npm run test:smoke` requires the seeded Compose backend and a running Next app.
It uses the local seed accounts (`admin@vantara.com.br`, `ap@vantara.com.br`) and
supports `SMOKE_ORIGIN` and `SMOKE_PASSWORD`. It runs only against localhost or
127.0.0.1, creates a uniquely named test user, and leaves that account **inactive**
after checking create/edit/deactivate/reactivate. It also checks non-admin denial,
self-administration denial and logout. No tokens are printed.

Standalone production output is built in a separate Docker stage. The Node
runtime runs as UID 1000, receives SIGTERM directly (with init in Compose/ECS),
and has a read-only root filesystem. All pages requiring backend data are dynamic,
so the image build needs no database/backend. Coverage reports live in `coverage/`.

`src/instrumentation.ts` registers OpenTelemetry with `@vercel/otel`; ECS exports
OTLP to the Datadog sidecar. Use the shadcn CLI for new components and keep local
imports under `@/`. Do not introduce secrets or private API URLs into client code.
