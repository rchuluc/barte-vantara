# Foundation verification — 2026-11-13

During initial verification, no commits, AWS applies, or live deployments were performed. The local Compose
stack was left running for review at **http://127.0.0.1:3000**.

## Definition of done

- [x] Both hello-world applications run.
- [x] Backend reads PostgreSQL 17 using the restricted runtime role.
- [x] Next.js renders the greeting fetched from the backend route.
- [x] Both multistage, non-root Docker images build and run with health checks.
- [x] Compose starts backend, frontend, database, migration job and Floci S3.
- [x] Modular Terraform passes `validate`; four mocked plan tests pass.
- [x] Both app test engines pass their enforced 95% coverage gates.
- [x] Scoped CI/security/deploy workflows exist and pass actionlint.
- [x] Root and both app READMEs document development and context.
- [x] Root and both apps have canonical AGENTS.md instructions.
- [x] Root instructions document Lefthook and Conventional Commit rules.

## Executed checks

| Check | Result |
|---|---|
| Backend HTTP/PostgreSQL/RLS integration tests | 6 passed, including database outage and real migration/runtime entrypoints |
| Backend coverage | 100% lines and branches; 95% gate passes |
| Frontend behavior tests | 12 passed |
| Frontend coverage | 100% lines, branches, statements and functions; 95% gate passes |
| Frontend ESLint / typecheck / production image build | Passed |
| Kotlin ktlint / Gradle check | Passed |
| Root / frontend Prettier | Passed; enforced in CI and Lefthook |
| Terraform format / validate / mocked tests | Passed, 4 test runs |
| Deployment failure/rollback tests | 4 passed |
| GitHub Actions syntax (actionlint) | Passed |
| Lefthook configuration / Compose configuration | Passed |
| Floci S3 | Bucket creation, object write/read/content verification/delete passed |
| Migration rerun | Exits 0 without replaying V1; history RLS callback remains idempotent |
| SIGTERM | Both apps stop within timeout, no OOM or SIGKILL; backend logs graceful shutdown |

RLS tests check that all public tables ENABLE/FORCE RLS, the runtime role is
neither superuser nor BYPASSRLS, migration history is inaccessible, and writes are
denied even if INSERT permission is temporarily granted to the runtime role.

## Containers and security

Follow-up verification: the backend image was rebuilt and Compose reports it
healthy with `GET /api/health` returning HTTP 200 and UP. The integration test
pauses real PostgreSQL, verifies HTTP 503/DOWN and HTTP 200 for
`/api/health/liveness`, then unpauses PostgreSQL in `finally`.
Actuator uses `/api` as its base path; readiness is `/api/health/readiness`.
The installed Spring Boot version rejects multi-segment health-group aliases.

Dive passed again (99.78% efficiency), as did Terraform and backend configuration/
secret scans. A fresh image SBOM scan could not complete because Syft ran out of
local disk space extracting layers. The image vulnerability results below refer
to the initial build, not the rebuilt health-route image.

- Application base images are pinned to multi-platform digests. GitHub Actions
  are pinned to commit SHAs; Dependabot tracks updates.
- Frontend runtime contains Node without npm/Yarn. Removing unused package
  managers eliminated the HIGH CVEs found in their bundled dependencies.
- Trivy frontend image scan: zero HIGH/CRITICAL findings.
- Backend: direct Trivy image scanning could not unpack the large Java index
  within available host disk space. Alternative verification generated a complete
  image SBOM with Syft (1,391 components) and scanned it with Trivy: zero
  HIGH/CRITICAL vulnerabilities. This is not a successful direct image/secret scan;
  CI still requires the full Trivy image scan.
- Trivy source dependency/config/secret scan: zero HIGH/CRITICAL findings in
  scanned app sources and Dockerfiles. Java dependencies are covered by the image
  SBOM scan rather than the source scan.
- Trivy Terraform: zero unsuppressed HIGH/CRITICAL findings, with three narrow
  documented design exceptions (public ALB, outbound TLS, SSE-S3).
- npm audit still reports seven **moderate, development-only** findings in the
  ESLint/typescript-eslint/minimatch chain. `npm audit fix` did not resolve them.
  No force upgrade or blanket security suppression was applied.
- Dive passes both images: backend ~99.78% efficient, frontend ~99.99% efficient.
  Remaining duplication is mostly small package metadata/certificate files.
  Local ARM64 image sizes are ~248 MB backend and ~178 MB frontend (uncompressed).
  Writable `/tmp` volume initialization was verified with non-root users and
  read-only root filesystems for both images.

Local machine-readable reports are in ignored `artifacts/`; app test/coverage
reports are under `apps/backend/build/reports` and `apps/frontend/coverage`.

## Boundaries of verification

AWS resources were validated statically only. ECR/ECS deployment, RDS-specific
behavior, Datadog ingestion, DNS/ACM, and GitHub environment/OIDC setup still need
an actual provisioned environment. See `infra/README.md` for bootstrap/configuration.
Datadog traces/metrics are configured; organization-level CloudWatch-to-Datadog
log forwarding is documented but not provisioned by this stack.

The coverage follow-up exercises both bootstrap branches against PostgreSQL:
migration closes its context, while runtime stays active and serves the migrated
greeting through the restricted database role. Frontend tests cover document
language/content, telemetry registration, and interactive card actions/footer.
Both applications reach 100% coverage without exclusions or lowered thresholds.
The frontend production build and four deployment failure/rollback tests also pass.
