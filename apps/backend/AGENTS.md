# Backend instructions

Inherit root AGENTS.md. JDK 21, Kotlin, Spring Boot, Gradle Kotlin DSL.
Use `./gradlew ktlintFormat` and `./gradlew check`; Kotlin standard style is
enforced by ktlint. Prefer immutable vals, constructor injection, small services,
explicit return types on public boundaries, and parameterized SQL. KISS/DRY:
no repository/service indirection without a real responsibility.

Tests are nonnegotiable. JUnit Jupiter + Testcontainers PostgreSQL 17 exercise real
Flyway migrations, HTTP behavior and denied database operations. Docker must run.
With OrbStack/custom contexts, export DOCKER_HOST from `docker context inspect`
and set TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock.
JaCoCo requires >=95% line and branch coverage including application bootstrap.
Do not disable the gate or exclude bootstrap to make the initial scaffold green.

Runtime: DB_URL, DB_USER=app_user, DB_PASSWORD. Migration profile uses the separate
migration owner and APP_DB_PASSWORD (alphanumeric only). Runtime Flyway is off.
Every new table requires ENABLE/FORCE RLS and denial tests. Never use client-provided
tenant IDs as trusted authorization. Apply schema changes only via migrations.

After Docker changes: build, Trivy scan, and `CI=true dive vantara-backend:local
--ci-config ../../.dive-ci`. Keep non-root JRE runtime, health checks, bounded
heap, graceful shutdown and minimal runtime dependencies.
