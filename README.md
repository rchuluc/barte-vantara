# Vantara

Vantara is a multi-tenant financial operations application built for the Barte
case. It brings incompatible Protheus and Omie exports, Itaú bank statements,
and unstructured accounts-payable messages into a shared, auditable data model.

The goal is to help finance teams import, investigate, and reconcile their data,
with AI handling extraction and proposing work while people retain financial
approval authority. The same application supports multiple customers through
tenant-specific domains, branding, memberships, and data isolation.

## Contents

- [What the application does](#what-the-application-does)
- [Architecture and services](#architecture-and-services)
- [Run locally](#run-locally)
- [Local development](#local-development)
- [Configuration and credentials](#configuration-and-credentials)
- [Testing and quality gates](#testing-and-quality-gates)
- [Delivery and operations](#delivery-and-operations)
- [Documentation and development history](#documentation-and-development-history)

## What the application does

- **Structured ingestion:** CSV/XLSX detection for Protheus, Omie, and Itaú;
  manual mapping for other layouts; temporary previews; resumable processing;
  rejected-row correction; original files retained in versioned S3 storage after
  confirmation.
- **Financial workbench:** receivables, payables, bank entries, partial and
  multi-title allocations, source evidence, decision history, and independent
  reconciliation review. Shared bank accounts and statement imports can cover
  multiple business units without duplicating movements or balances.
- **AI import assistant:** paste text or attach TXT/EML/MD on `/imports`, clarify
  missing fields, then confirm or cancel a proposed payable import. Extraction
  uses AI SDK and OpenRouter; source text is retained with the saved import.
- **MCP access:** authenticated agents can query financial records, import
  payables, and propose reconciliations using each employee's existing scopes.
  Reconciliation approval remains in the UI, with a different authorized human.
- **Administration:** tenant branding, user roles and scopes, business-unit and
  bank-account management, and deactivation rather than deletion of those records.
- **Internationalization:** Brazilian Portuguese by default, English and Spanish.
  Language choice is a host-only browser cookie, not an account-wide preference.

This is an operational financial model, not a double-entry general ledger or a
claim of full ISO 20022 compliance. Money uses integer minor units with currency
codes. Matching suggestions are not proof of settlement. The application does
not execute payments or write reconciliations back to banks or ERPs.

## Architecture and services

```text
Browser → Next.js UI / server routes → Spring Boot APIs → PostgreSQL
                  │                         ├──────────→ Cognito
                  └→ AI SDK / OpenRouter     └──────────→ S3

Agent → Cognito OIDC + PKCE → Next.js /api/mcp → the same backend APIs
```

| Layer | Technology and responsibility |
| --- | --- |
| Frontend | Next.js 16, React, TypeScript, shadcn/ui, Tailwind, TanStack Query and next-intl |
| Backend | Kotlin, Spring Boot 4, Spring JDBC, Flyway and Actuator on JDK 21 |
| Persistence | PostgreSQL 17; tenant-aware relationships, transaction-local authorization and forced RLS |
| Identity | Cognito verifies identity; PostgreSQL owns memberships, roles, unit/account scopes and approval grants |
| Local AWS emulation | Floci 2.3.0 for S3 and Cognito; Docker runs the applications instead of ECS |
| AI | Server-side AI SDK 7 with OpenRouter; model selected through runtime configuration |
| Production | AWS ECS/Fargate, ECR, RDS, S3, Cognito, ALB/ACM, IAM and Secrets Manager, managed with Terraform |
| Observability | OpenTelemetry to Datadog sidecars; structured logs in CloudWatch; optional browser RUM |
| Delivery | GitHub Actions with OIDC, Trivy, Dive and Lefthook/Conventional Commits |

Frontend components call hooks, hooks call services, and server routes call the
private backend. Database-specific code lives behind repository contracts.
Technical administrators do not automatically gain financial access. Delegated
MCP calls are classified as AI-originated and cannot approve financial actions,
even when the employee has approval authority in the UI.

## Run locally

### 1. Start the stack

Install Docker with Compose v2. The containerized application needs no real AWS
credentials, Datadog account, or OpenRouter key for non-AI features.

From the repository root:

```sh
docker compose up -d --build
docker compose ps -a
curl --fail http://127.0.0.1:8080/api/health
curl --fail http://127.0.0.1:3000/api/health
curl --fail --resolve vantara.localhost:3000:127.0.0.1 http://vantara.localhost:3000/login
```

Open **http://vantara.localhost:3000/login**. Tenant selection is hostname-only;
`http://localhost:3000/vantara/login` is not a supported tenant URL. If your local
resolver does not resolve `vantara.localhost`, map it to `127.0.0.1` locally.

Compose runs Flyway, creates the local Cognito pool/users and tenant registration,
and initializes S3 before starting the backend. `migrate`, `seed`, and `s3-init`
are one-shot services: a successful exit is expected. Migration failure blocks
backend startup.

| Service | Local endpoint |
| --- | --- |
| Tenant UI | `http://vantara.localhost:3000` |
| Backend | `http://127.0.0.1:8080` |
| PostgreSQL | `127.0.0.1:5433`, database `vantara` |
| Floci | `http://127.0.0.1:4566` |

`POSTGRES_PORT` overrides the host database port. The backend health endpoint
includes PostgreSQL; frontend health checks only its own process. Use the tenant
login page as well as health probes when checking the full stack.

### 2. Sign in and configure access

All **local seed accounts** use password **`@Test123`**:

| Email | Role |
| --- | --- |
| `admin@vantara.com.br` | Technical Admin |
| `ap@vantara.com.br` | Accounts Payable |
| `ar@vantara.com.br` | Accounts Receivable & Collections |
| `reconciliation@vantara.com.br` | Reconciliation |
| `controllership@vantara.com.br` | Controllership |
| `fpa@vantara.com.br` | FP&A |

The seed creates no business units, bank accounts, financial records, or approval
grants. Create destinations and assign unit/account access before testing imports.
Roles alone do not grant access to every destination; admin alone cannot import
financial records. User management also prevents self-administration.

Independent approval grants are provisioner-managed in PostgreSQL, not assigned
through user-management routes. A complete reconciliation test needs a proposer
and a different reviewer with the relevant unit, account and approval scopes.
See [identity and authorization](apps/backend/AUTH.md) and the
[local reconciliation walkthrough](docs/reconciliation-flow-evidence-2026-11-18.md).

### 3. Try the supplied data

Read [the data-pack guide](data_pack/00_LEIA-ME.md), then use `/imports`:

1. Use an authorized AR account for Protheus/Omie receivables or a bank-authorized
   account for the Itaú statement.
2. Select a file and review detection, columns, currency and destinations. A
   preview is not saved; reloading before confirmation loses the selected file.
3. Choose **Confirm and import**. Keep the detail page open while sequential
   batches run. Reopening an unfinished import resumes processing.
4. Review errors and source evidence, then use `/reconciliation` to propose
   allocations and have an independent reviewer confirm them.

For unstructured payables, configure OpenRouter below and use an AP account.
Follow the [AI import test guide](docs/ai-import-assistant-test.md), which includes
explicit choices for ambiguous sample dates and duplicate invoice references.

### 4. Inspect, restart, or reset

```sh
docker compose logs -f backend frontend
docker compose logs migrate seed s3-init
docker compose exec database psql -U migrator -d vantara
docker compose down
```

Database inspection connections (local-only credentials):

```text
postgresql://migrator:localMigrationOnly@127.0.0.1:5433/vantara
postgresql://app_user:localRuntimeOnly@127.0.0.1:5433/vantara
```

Use the owner account for local inspection. The runtime account is RLS-restricted
and requires verified transaction-local context to read financial data.

`docker compose down` preserves the named PostgreSQL, Floci and auth volumes.
**`docker compose down -v` deletes local database, stored files and identity
configuration.** Starting again recreates only the initial seed. Rebuilding with
`docker compose up -d --build` applies new migrations and preserves existing data.

## Local development

Install Node.js 24, JDK 21 and Docker. Infrastructure checks require Terraform
**>=1.10 and <2.0**. Security/container checks require Trivy and Dive; AWS operations
require AWS CLI credentials for the intended account. Use the checked-in Gradle
wrapper and npm lockfiles.

```sh
npm ci
npm --prefix apps/frontend ci
```

The root install registers Lefthook hooks.

### Frontend with hot reload

Keep the Compose backend running and stop its frontend to free port 3000:

```sh
docker compose stop frontend
npm --prefix apps/frontend run dev
```

Open `http://vantara.localhost:3000/login`. Alternatively, keep Compose's frontend
and start a separate dev server with:

```sh
npm --prefix apps/frontend run dev -- --port 3217
```

Open `http://vantara.localhost:3217/login`. Native development defaults to backend
`http://localhost:8080`; set `BACKEND_URL` if needed. TanStack Query Devtools are
enabled in development. Restart Next.js after changing environment variables.

### Backend on the host

Start the full stack once so migrations and the identity seed complete. Copy the
generated, non-secret Cognito configuration before stopping the backend container:

```sh
docker compose cp backend:/auth/cognito.properties apps/backend/.env.cognito.properties
docker compose stop backend
```

In that ignored file, change only the `cognito.jwks-uri` hostname from `floci` to
`localhost` so the host process can fetch signing keys. Keep the issuer unchanged.
Then, from `apps/backend`:

```sh
DB_PASSWORD=localRuntimeOnly \
COGNITO_ENDPOINT=http://localhost:4566 \
INGESTION_ENDPOINT=http://localhost:4566 \
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
SPRING_CONFIG_IMPORT="file:$PWD/.env.cognito.properties" \
./gradlew bootRun
```

The database defaults to `localhost:5433`; override `DB_URL` if you changed
`POSTGRES_PORT`. Apply new migrations with `docker compose run --rm migrate`
before restarting the host backend. Runtime Flyway is disabled deliberately.

### Add a development tenant

Branding and domain mappings come from the database in every environment, with
no `tenants.json` fallback. From the repository root:

```sh
npm run tenant:add
# Or provide the fields directly:
npm run tenant:add -- --name "Acme Finance" --slug acme --primary '#112233' \
  --domains acme.localhost --email admin@acme.test
```

The script generates the tenant ID and creates a local administrator using
`@Test123`. Open `http://acme.localhost:3000/login`. It does not create financial
destinations or grant financial approval authority.

## Configuration and credentials

### Local defaults and external services

| Setting | Purpose and local setup |
| --- | --- |
| `BACKEND_URL` | Server-only Next.js API target; native default `http://localhost:8080`, Compose uses `http://backend:8080` |
| `DB_URL`, `DB_USER`, `DB_PASSWORD` | Backend database connection; Compose supplies the local runtime credentials |
| `APP_DB_PASSWORD` | Migration-only provisioning of the runtime database login; Compose uses `localRuntimeOnly` |
| `AWS_REGION` | Defaults to `us-east-1` for backend AWS clients |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Both `test` for Floci only; production uses ECS task roles |
| `COGNITO_ENDPOINT`, `COGNITO_JWKS_URI` | Local/test overrides; Compose seed generates pool, client, issuer and JWKS configuration |
| `COGNITO_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_ISSUER` | Cognito identity settings; supplied by the local seed or production infrastructure |
| `INGESTION_BUCKET`, `INGESTION_ENDPOINT` | Local ingestion bucket `vantara-ingestion-local` and Floci endpoint; omit endpoint override for AWS |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Required only for AI extraction/chat; use your own key and a model supporting structured outputs and tool calls |
| `COGNITO_MCP_CLIENT_ID` | Dedicated delegated OIDC client; frontend also requires `COGNITO_ISSUER`; unset disables MCP |
| `TENANT_NOT_FOUND_REDIRECT_URL` | Optional browser redirect for unknown tenants; unset means 404; production explicitly uses `https://www.barte.com` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Server tracing destination; production targets the per-task Datadog agent |
| `NEXT_PUBLIC_DD_APPLICATION_ID`, `NEXT_PUBLIC_DD_CLIENT_TOKEN` | Optional browser RUM identifiers; intentionally public, not Datadog API/application keys |

Floci uses path-style S3 addressing. `s3-init` creates `vantara-local` and the
versioned, encrypted `vantara-ingestion-local` bucket. Its endpoint is
`http://floci:4566` inside Compose and `http://localhost:4566` on the host.

### Enable AI locally

Create or edit the ignored **`apps/frontend/.env.local`**, preserving any existing
settings. Use placeholders below as a guide, not as working credentials:

```dotenv
BACKEND_URL=http://localhost:8080
OPENROUTER_API_KEY=<your-openrouter-api-key>
OPENROUTER_MODEL=<provider/model-id>
```

Run the Next.js development server as described above. AI calls send the supplied
source text to OpenRouter and its configured model provider and may incur charges.
The rest of the application does not need this key.

**Compose does not load this file into the frontend container automatically.**
For containerized AI testing, create an ignored root `compose.override.yml`
(for example, add it to `.git/info/exclude`) with:

```yaml
services:
  frontend:
    env_file:
      - ./apps/frontend/.env.local
```

Then run `docker compose up -d frontend`. Compose's explicit `BACKEND_URL` keeps
the internal `http://backend:8080` target. Do not put API keys in Docker build
arguments, public frontend variables, or committed files.

### MCP and production credentials

Connect to `https://<registered-tenant-host>/api/mcp` with a pre-registered Cognito
client, authorization code + PKCE, and tokens bound to that exact resource URL.
Floci 2.3.0 cannot issue the resource-bound tokens required here: local protocol
and integration tests work, but full interactive MCP login requires real Cognito.
Web login and MCP login are separate sessions.

The MCP host must request human approval before invoking payable-import writes.
This is separate from the platform chat's signed confirmation button. No MCP
tool can approve reconciliations. See [MCP setup](docs/mcp-imports.md) and
[agent queries and proposals](docs/mcp-reconciliation.md).

Production stores the OpenRouter and Datadog API keys in **AWS Secrets Manager**;
Terraform receives secret ARNs, not raw keys. RDS migration and runtime passwords
are separate. Datadog application keys are operator tooling credentials, not
application runtime requirements. GitHub deployments use short-lived OIDC
credentials rather than static AWS access keys. Frontend RUM identifiers, when
enabled, are build-time public configuration and are distinct from server secrets.

## Testing and quality gates

From the repository root, with Docker running:

```sh
npm --prefix apps/frontend run format:check
npm --prefix apps/frontend run lint
npm --prefix apps/frontend run typecheck
npm --prefix apps/frontend run test:coverage
npm --prefix apps/frontend run build
npm run test:actions
npm run format:check
```

From `apps/backend`:

```sh
./gradlew check
```

For OrbStack or another custom Docker context, export these before running Gradle:

```sh
export DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

Backend integration tests run real PostgreSQL and Floci containers. Frontend
tests use Vitest and Testing Library. Coverage gates require **95%** backend
lines/branches and frontend lines/branches/functions/statements. Use `npm test`
at the root to run frontend coverage and backend checks together. Reports live
in `apps/frontend/coverage/` and `apps/backend/build/reports/`.

Additional checks from the repository root:

```sh
# Static infrastructure validation and mocked tests; no apply.
terraform -chdir=infra fmt -check -recursive
npm run infra:test

# Live local HTTP smoke test; requires the seeded stack and Next.js on :3217.
SMOKE_ORIGIN=http://127.0.0.1:3217 npm --prefix apps/frontend run test:smoke

# Four-case live AI benchmark; requires .env.local and makes paid provider calls.
npm --prefix apps/frontend run benchmark:unstructured

# Container checks after building the Compose images.
CI=true dive vantara-backend:local --ci-config .dive-ci
CI=true dive vantara-frontend:local --ci-config .dive-ci
trivy image --severity HIGH,CRITICAL --exit-code 1 vantara-backend:local
trivy image --severity HIGH,CRITICAL --exit-code 1 --ignorefile apps/frontend/.trivyignore.yaml --show-suppressed vantara-frontend:local
trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 --ignorefile apps/frontend/.trivyignore.yaml --show-suppressed --skip-dirs node_modules --skip-dirs .next apps/frontend
```

The smoke test connects over loopback and sets the tenant Host header itself;
it creates a local user and leaves it inactive. The AI benchmark
stores evidence under ignored `artifacts/unstructured/`; four sample cases are
not a general model-accuracy guarantee. The frontend's narrowly scoped,
time-limited Trivy exception is documented in its [README](apps/frontend/README.md).

If this checkout was initialized with a real Terraform backend, use a fresh
`TF_DATA_DIR` for static checks to avoid reusing remote backend metadata.
Lefthook runs scoped checks before commits and enforces Conventional Commits,
for example `feat(imports): add mapped file preview`.

## Delivery and operations

- `ci-frontend` and `ci-backend` run path-filtered PR checks, coverage, security
  scans and image-efficiency checks.
- `cd-frontend` and `cd-backend` run on relevant pushes to `main`, repeat the
  gates, publish the verified image to ECR and deploy its digest to ECS.
- Backend deployment runs Flyway in a separate migration task before rollout.
  A failed migration blocks release; rollout checks detect failed revisions and
  rollback rather than accepting an older healthy task as success.
- `ci-infrastructure` validates both Terraform roots, runs mocked tests and
  security scans, and produces read-only plans for trusted PRs through the
  protected `prod-plan` environment. CI never applies infrastructure.
- `provision-tenant` is a manual workflow: enter branding, domain and the first
  administrator's email. It generates the tenant ID and uses GitHub OIDC to
  invoke the backend. Cognito sends a temporary password for first-login replacement.

For a new AWS environment, bootstrap the encrypted/versioned state bucket first,
configure OIDC, certificate/DNS and secret references, publish initial images,
then apply the application stack and run its first migration before starting
services. Follow the [infrastructure guide](infra/README.md) and
[tenant provisioning guide](docs/tenant-provisioning.md) for the exact variables
and operator steps. Protect Terraform state: it contains database credentials.

Infrastructure task-template changes need a service revision update; image-only
deployments clone the running revision and do not automatically pick up a new
Terraform template. Secret rotation likewise requires new ECS tasks.

Production exposes the frontend through the ALB; the backend is reachable only
through the permitted internal network path. RDS is private. Containers use
non-root application processes, read-only root filesystems, health checks and
graceful shutdown. Flyway migrations are immutable and must be compatible with
application rollback; ECS rollback does not undo SQL migrations.

Datadog receives server traces and Fargate metrics through per-task agents.
Structured logs go to CloudWatch with 14-day retention; Datadog log forwarding
requires the separate AWS integration/forwarder setup. Local Compose does not
run a Datadog agent. Infrastructure sizing, retention and budget alerts are
documented in the infrastructure guide; budget alerts are not spending caps.

## Documentation and development history

| Guide | Contents |
| --- | --- |
| [Backend](apps/backend/README.md) | Runtime, migrations and backend checks |
| [Frontend](apps/frontend/README.md) | Routing, services/hooks, UI and internationalization |
| [Database](apps/backend/DATABASE.md) | Financial schema, provenance and RLS contract |
| [Identity](apps/backend/AUTH.md) | Roles, scopes, seed accounts and independent approvals |
| [Structured ingestion](docs/structured-ingestion.md) | Upload, mapping, batch processing and corrections |
| [AI extraction](docs/unstructured-extraction.md) | Prompt versions, evidence and benchmark boundaries |
| [AI import testing](docs/ai-import-assistant-test.md) | Manual confirmation/cancellation scenarios |
| [Reconciliation](docs/receivables-reconciliation.md) | Workbench and allocation behavior |
| [MCP imports](docs/mcp-imports.md) | Cognito setup and delegated import tools |
| [MCP reconciliation](docs/mcp-reconciliation.md) | Queries, match evidence and human-reviewed proposals |
| [Local end-to-end evidence](docs/reconciliation-flow-evidence-2026-11-18.md) | UI import, proposal, independent review and balances |
| [Infrastructure](infra/README.md) | Bootstrap, AWS configuration, costs and deployment |
| [Tenant provisioning](docs/tenant-provisioning.md) | Production workflow and local tenant creation |
| [Engineering rules](AGENTS.md) | Code standards, tests and commit policy |
| [AI development sessions](ai-development-sessions/README.md) | Session-by-session decisions, corrections, validation limits and commits |

The development-session notes are in Brazilian Portuguese and preserve the
author's review process. Historical verification reports describe what was
tested at that point; they do not replace checks against the current revision.
