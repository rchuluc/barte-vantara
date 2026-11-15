# Vantara foundations

Monorepo: Kotlin/Spring Boot backend, Next.js 16 + TypeScript + shadcn frontend,
PostgreSQL 17, local Floci S3, AWS ECS/ECR/RDS/S3 and modular Terraform.

## Run locally

Requires Docker Compose v2. No AWS credentials are needed.

```sh
docker compose up -d --build
curl --fail http://127.0.0.1:8080/api/hello
curl --fail http://127.0.0.1:3000/api/health
open http://127.0.0.1:3000
docker compose logs -f backend frontend
docker compose down
```

The page fetches the backend on the **Next.js server**, and the backend reads a
greeting from PostgreSQL using a restricted runtime role. Compose runs Flyway
to completion before starting the backend. Migration failure blocks startup.
The database persists in a named volume; `docker compose down -v` is a destructive
local reset. The credentials in compose are local-only, never production values.
PostgreSQL binds to 127.0.0.1:5433 (`POSTGRES_PORT` overrides the host port).
Use 127.0.0.1 URLs for Compose: localhost may resolve to IPv6 and reach another
local service if one is already listening there.

Floci exposes S3 at http://localhost:4566. `s3-init` creates `vantara-local`.
Use AWS region `us-east-1`, access key/secret `test`, and path-style addressing.
Only S3 is emulated; Docker itself hosts the applications in place of ECS.

## Develop and verify

Install Node 24, JDK 21, Terraform >=1.7, Trivy and Dive. Gradle is bootstrapped by
the checked-in wrapper. Docker must be running for backend integration tests.

```sh
npm ci                              # installs Lefthook hooks
npm --prefix apps/frontend ci
npm --prefix apps/frontend run test # functional tests only
npm --prefix apps/frontend run test:coverage # enforced 95% gate
cd apps/backend && ./gradlew test   # functional tests only
# From root:
npm run infra:test                 # init (no backend), validate, mocked tests
terraform -chdir=infra fmt -check -recursive
python3 -m unittest discover -s scripts -p 'test_*.py'
CI=true dive vantara-backend:local --ci-config .dive-ci
CI=true dive vantara-frontend:local --ci-config .dive-ci
trivy image --severity HIGH,CRITICAL --exit-code 1 vantara-backend:local
trivy image --severity HIGH,CRITICAL --exit-code 1 vantara-frontend:local
```

On OrbStack/custom Docker contexts, before Gradle:
```sh
export DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

Coverage gates enforce at least 95% for both applications. The foundation tests
currently achieve 100% coverage, including application bootstrap and frontend
layout/instrumentation. CI/deployment also requires the security checks to pass.

## Delivery and operations

- [Backend instructions](apps/backend/README.md)
- [Frontend instructions](apps/frontend/README.md)
- [Infrastructure, costs, bootstrap and deployment setup](infra/README.md)
- [Engineering and Conventional Commit rules](AGENTS.md)
- [Executed checks, coverage results and DoD](docs/verification.md)

`ci-frontend` and `ci-backend` run path-filtered PR checks: formatting,
lint/types/tests, 95% coverage, Trivy source/image scans, and Dive efficiency.
`cd-frontend` and `cd-backend` run on app-related pushes to `main`, repeat the
quality gates, build/check/publish the same image to ECR, and deploy its digest
to ECS through GitHub OIDC. Shared composite actions live in `.github/actions`.
Changes to those actions validate both apps; app-only changes stay scoped.
The repository tooling workflow checks formatting, commits, and mocked AWS CLI
deployment tests (`npm run test:actions`).

`ci-infrastructure` runs Terraform validation, mocked tests, security scans,
and a live read-only AWS plan for trusted PRs, posting a sticky summary of
validation and add/change/destroy counts. Configure the `dev-plan` environment
and S3 backend as described in [the infrastructure guide](infra/README.md).
Fork/Dependabot PRs receive static checks and a job summary only. CI never applies.

Both ECS services have container health checks, init processes, non-root app
users, read-only root filesystems, graceful termination, and deployment rollback.
Backend deployment runs a separate migration task and checks its exit code before
updating the service. Deployment verifies the final revision to detect rollback.

Datadog receives OTLP traces from Spring and Next.js via a per-task agent, plus
Fargate metrics. Structured application logs go to CloudWatch with 14-day
retention; see infrastructure docs for Datadog log forwarding setup.
