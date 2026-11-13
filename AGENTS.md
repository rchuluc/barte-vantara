# Vantara engineering instructions

Read the app-local AGENTS.md before editing. This monorepo contains `apps/backend`
(Kotlin/Spring Boot), `apps/frontend` (Next.js 16/TypeScript/shadcn), and modular
Terraform in `infra`. Keep changes scoped; KISS and DRY. Share code only when real
duplication exists. Avoid speculative layers, broad refactors, or hidden side effects.

## Environment and checks
- Use blank lines between Terraform blocks, workflow sections/steps, and logical
  frontend code sections. Frontend and workflow Prettier checks run in CI/hooks.
- Node 24, npm lockfiles, JDK 21, the checked-in Gradle wrapper, Terraform >=1.7,
  Docker Compose v2, Trivy, and Dive. `npm ci` installs Lefthook.
- `docker compose up -d --build` runs PostgreSQL 17, a one-shot Flyway migration,
  backend, frontend, Floci S3, and bucket initialization.
- Tests are nonnegotiable. Cover behavior, errors, authorization and database
  boundaries. Never replace PostgreSQL integration tests with H2.
- Both engines enforce 95% coverage. Do not lower thresholds, add blanket
  exclusions, skip failing tests, or use `continue-on-error` to merge/deploy.
  The initial foundation may be red until the coverage backlog is completed.
- Run app lint/type checks and tests, `terraform fmt -check -recursive`,
  `terraform validate`, and mocked `terraform test` for relevant changes.
- After container changes, build and scan with Trivy and run
  `CI=true dive <image> --ci-config .dive-ci`. Inspect size/layers, remove caches
  and unnecessary runtime dependencies. Keep multistage builds, non-root users,
  exec-form commands, health checks, read-only application filesystems and SIGTERM.
- Every SQL table, including migration history, must ENABLE and FORCE RLS.
  Runtime credentials must never own tables or have BYPASSRLS/superuser rights.
  Add explicit policies and integration tests. Public reference data is not a
  precedent for tenant-data policies; tenant identity must come from trusted auth.
- Schema changes are immutable Flyway migrations, run before backend rollout.
  Use backward-compatible expand/contract migrations so application rollback works.
- Never apply Terraform or deploy AWS as part of static verification.

## Commit policy (Lefthook)
`lefthook.yml` runs scoped app tests/lint and infrastructure tests at pre-commit.
`commit-msg` invokes commitlint with Conventional Commits:
`type(scope): imperative summary`, e.g. `feat(backend): expose greeting route`.
Types include feat, fix, docs, test, refactor, perf, build, ci, chore, revert;
use `!` or a BREAKING CHANGE footer for breaking changes. Do not bypass hooks.
Do not commit this foundation until the user has reviewed it.
