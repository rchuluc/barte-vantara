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
Tenants are selected only by hostname. Open `http://vantara.localhost:3217/login`
for the seeded workspace. Tenant-prefixed browser paths are rejected.

## Security scan exception

CI uses `.trivyignore.yaml` for the withdrawn picomatch advisory
`CVE-2026-112366` only, scoped to version 4.0.7 and expiring on 2026-12-19.
The file includes upstream evidence; remove the exception when Trivy's database
reflects the withdrawal. Other high/critical findings, including unfixed ones,
still fail CI. From the repository root, reproduce the source scan with:

```sh
trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 --ignorefile apps/frontend/.trivyignore.yaml --show-suppressed --skip-dirs node_modules --skip-dirs .next apps/frontend
```

## Internationalization

`next-intl` provides `pt-BR` (Brazilian Portuguese, the default), `en` (English),
and `es` (Spanish). The language selector is available on the workspace picker,
sign-in page, and workspace sidebar. The explicit choice is stored for one year
in the host-only `vantara-locale` cookie; it is a browser preference, not an
account setting synchronized across devices. Missing or unsupported values fall
back to `pt-BR`, regardless of the browser's language.

`src/i18n/request.ts` loads the selected catalog from `messages/`. The root layout
sets the document language and supplies the same messages to client components.
The server action validates choices and updates the cookie, which makes Next.js
render the updated locale while preserving client state. Locale selection does
not add URL prefixes or change hostname-based tenant routing.

All pages, dialogs, validation, import-assistant controls, reconciliation details,
and shared feedback use the catalogs. Known application-generated API messages
are localized; original source values and arbitrary user text are preserved.
Dates use UTC and numbers/currencies use the selected locale. The import assistant
receives the selected language in its system prompt. The sign-in selector stays
in the bottom-right corner.

For new translations, add the same namespaced keys to all three catalogs;
use `useTranslations` in client components and `getTranslations` in server
components. Use ICU variables for names/counts rather than concatenating messages.
`tests/i18n.test.tsx` checks all catalogs, fallback behavior, persistence, selector
failures, and rendering in each language. `tests/i18n-pages.test.tsx` exercises
localized feature pages and dialogs. The shared test provider supports all three
locales; reconciliation behavioral tests explicitly select Portuguese.

## Tenants and branding

Every environment reads persisted branding from backend `GET /api/tenants`.
There is no local JSON or environment-variable tenant configuration. The loader
in `src/lib/tenants.ts` uses uncached reads; refresh to see database changes.
Unavailable or invalid backend responses fail closed.

Set server-side `TENANT_NOT_FOUND_REDIRECT_URL` to an absolute HTTP(S) URL to
redirect browser requests with no matching tenant (307). There is no default;
unset or blank keeps unknown-tenant 404s. API routes still return JSON errors,
and backend outages are not treated as missing tenants. Unmapped hosts cannot
select tenants through a URL path. API routes resolve their tenant from Host
and use paths such as `/api/signin` and `/api/me`.

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
`http://acme.localhost:3000/login` (or port 3217 for a separate dev server).
See [tenant provisioning](../../docs/guides/tenant-provisioning.md) for production registration.

Each tenant needs a corresponding database tenant and active memberships. Slugs
and exact domain mappings must be unique; arbitrary `vantara.*` domains are not
trusted automatically. Configure DNS/TLS and your ingress for production domains.
Next's proxy internally rewrites mapped-domain routes into `app/[tenant]` while
the browser keeps `/login`, `/dashboard`, `/users`, or `/profile`. Explicit
`/[tenant]/...` URLs are rejected. The name is the text logo and document title; the primary
color drives branded surfaces/actions, with automatically contrasted text.

## Data imports

Open `/imports` from the workspace navigation. Screens call `use-imports` hooks,
which call the `imports` service; the tenant-scoped API proxy validates responses
and keeps credentials on the server.

1. Choose **New import**, a dataset, and a nonempty CSV/XLSX file (up to 100 MiB).
2. Review detected columns, required fields, destination units, dates, and currency.
3. Choose **Confirm and import**. TanStack Query runs sequential batches (up to
   500 records per request), updating the progress bar after each batch.
4. Review rejected rows and save corrections in the dialog; processing resumes
   automatically. Failed requests stop the loop and offer a retry.

Keep the detail page open while importing. Leaving stops scheduling further
batches; reopening an unfinished import resumes from its persisted progress.

**Preview file** only reads a temporary server file and returns headers plus up to
20 sample rows. The temporary file is deleted when the request ends; no database
import or S3 object is created. The browser retains the original `File` in memory
until **Confirm and import** is clicked, when it is sent to the durable ingestion
endpoint. Closing/reloading the browser loses an unconfirmed preview. **All imports**
asks before discarding it. Refreshing or closing the tab while a preview is active
triggers the browser's leave warning. Continuing discards the preview; reopening
its URL shows recovery guidance to select the file again. After confirmation, failed operations remain retryable
using the same upload ID.

Upload requires `draft_receivable`, `draft_payable`, or `bank` permission for the
chosen dataset. The administrator role alone grants configuration, not upload
access. Existing backend unit/account authorization still applies to every import.
Bank imports currently take an existing bank-account UUID because the backend does
not expose an account-list endpoint. Custom multi-unit files require explicit name
mapping; Protheus unit names use the backend's automatic resolution.

Use a backend build containing the ingestion migrations and `/api/imports` routes.
Network failures can be retried with the same upload key; interrupted preparation
can be resumed from the detail screen. Files whose original upload never persisted
must be uploaded again. Tests cover the UI-to-service flow and proxy boundaries
with controlled responses; live ingestion additionally requires the backend and S3.

### AI import assistant

The bottom-right **Import assistant** is available only on `/imports` to members
with `draft_payable`. It uses AI SDK UI (`useChat`) and the existing server-side
OpenRouter configuration: `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`.

The **Ask Vantara** launcher opens a nonmodal chat beside the imports page. Paste
source text or attach a UTF-8 TXT, EML, or MD file (up to 64 KB) and send a message.
The assistant automatically calls the existing evidence extractor when needed,
summarizes its findings, and asks about missing information in the user's language.
There is one composer: Enter sends, Shift+Enter inserts a newline, and the paperclip
attaches files. PDF/image extraction is not supported; CSV/XLSX still use **New import**.

After parsing, the assistant asks whether to import, resolves missing fields, and
uses `listBusinessUnits` to select a destination. `createImport` presents up to 100
payable rows (supplier, document, exact decimal amount, currency, and full due date).
**Confirm import** resumes the server tool; **Cancel import** saves nothing.
The AI SDK signs approval requests with a session-, user-, and tenant-bound secret
and verifies them before execution. Approval is a UI action, never an inferred
payment/approval claim from source text. All imported payables start open.
Successful tool results include `confirmation=user_approved` so the assistant
can acknowledge the button-based confirmation even without a typed chat reply.
The completed review also displays **Confirmed by you**.

The tool reuses backend upload → mapping confirmation → processing. A generated
CSV preserves normalized fields and the exact source in eight bounded text cells,
marked `source_type=agent_unstructured`. The existing pipeline stores ingestion
rows, source records, and structured payable titles under its existing RLS rules.
The original download is this generated CSV, including the source text. The import
uses the existing `custom` platform and rule-based normalization. No new financial
posting or settlement is inferred. Results link to the import detail page and refresh
history. **Retry import** reuses the same approved call and backend idempotency key.

Chat history itself is in memory. Closing the panel preserves it; leaving the page
or choosing **New chat** clears it, but saved imports remain in history.
Requests require the same tenant authentication, active membership,
permission, and same-origin checks as other imports. Conversations are bounded
to 40 messages and 256 KiB per request, with a 60-second inference timeout, at most
four agent steps, and one extraction per turn. The extraction tool selects an exact
original user message; the model cannot replace the source with invented text.

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
