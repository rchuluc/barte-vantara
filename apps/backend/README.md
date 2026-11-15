# Backend

Kotlin / Spring Boot 4, JDK 21, Gradle wrapper, Spring JDBC, Flyway, Actuator.
See [AUTH.md](AUTH.md) for Cognito sign-in, scoped user-management routes,
development seed accounts and OIDC/RBAC/RLS enforcement.
`GET /api/hello` reads PostgreSQL 17. `GET /api/health` exposes application health,
including a PostgreSQL connectivity check: HTTP 200 when UP and
HTTP 503 when DOWN. Error details and database credentials are never exposed.
`/api/health/readiness` includes PostgreSQL, and `/api/health/liveness`
checks application liveness independently of PostgreSQL availability.

From repo root: `docker compose up -d --build`. For hot local development:

```sh
docker compose up -d database
docker compose run --rm migrate
cd apps/backend
DB_PASSWORD=localRuntimeOnly ./gradlew bootRun
```

DB_URL defaults to jdbc:postgresql://localhost:5433/vantara and DB_USER to app_user.
DB_PASSWORD is required. `./gradlew ktlintFormat` formats; `./gradlew test` runs
HTTP + PostgreSQL/RLS integration tests; `./gradlew check` additionally enforces
ktlint and 95% JaCoCo line/branch coverage. Reports: `build/reports/`.
See root README for custom Docker context environment variables.

## Database security and migrations

Runtime never owns tables, has no BYPASSRLS and cannot write greetings or access
Flyway history. Both tables ENABLE and FORCE RLS. The greeting is public reference
data with a read-only policy. The financial foundation adds tenant/identity/unit
RLS, versioned ingestion, financial evidence and review records. See
[DATABASE.md](DATABASE.md) for the schema, repository boundary, authentication
contract, assumptions and database integration tests.

`--spring.profiles.active=migrate` runs Flyway then exits. It uses the migration
owner's DB_USER/DB_PASSWORD and APP_DB_PASSWORD to provision the runtime login.
APP_DB_PASSWORD must contain only ASCII letters/digits (Terraform generates it).
Migration credentials are injected only into that task, never the web app.
Versioned migration files are immutable after deployment. Use expand/contract,
not destructive migrations coupled to application rollback. Password rotation
requires changing the database role and secret together; rerunning V1 does not
rotate credentials. Do not manually regenerate the Terraform random password.

## Containers and observability

`docker build -t vantara-backend:local apps/backend` from root builds with a JDK
and ships only the JRE + executable JAR + health probe. UID 10001; exec-form Java;
25-second graceful shutdown and 35-second container stop timeout. JVM heap is
bounded to 65% of container memory. Trivy and Dive run in CI.

Spring's OpenTelemetry starter exports traces to OTEL_EXPORTER_OTLP_ENDPOINT in
ECS (the Datadog sidecar). Structured logstash JSON goes to stdout/CloudWatch.
Do not log secrets, request authorization headers, or personal data.
