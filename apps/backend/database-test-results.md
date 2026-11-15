# Database verification results

Verified locally on 2026-11-14 with JDK 21, PostgreSQL 17 Alpine Testcontainers,
OrbStack and the checked-in Gradle wrapper.

```sh
export DOCKER_HOST=unix:///Users/rchuluc/.orbstack/run/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
./gradlew ktlintFormat
./gradlew check
```

**PASS: 27 tests; zero failures, errors or skips.**

| Suite                            | Tests | Result |
| -------------------------------- | ----: | ------ |
| FinancialDatabaseTests           |    19 | Passed |
| FinancialRepositoryTests         |     2 | Passed |
| Existing BackendApplicationTests |     5 | Passed |
| Existing BootstrapTests          |     1 | Passed |

Kotlin lint passed. JaCoCo: **158/158 lines, 12/12 branches (100%)**; the existing
95% gates are unchanged. This measures Kotlin, not SQL trigger/policy coverage.

Database tests exercised tenant and unit isolation, missing/inactive/wrong-issuer
context, two-tenant identities and reused-connection context reset; six role
boundaries; raw-data denial for admin/FP&A; separate human approval scopes,
self-approval denial, stale submissions and AI-origin protection; cross-tenant
foreign keys; immutable evidence/audit; stable reimport keys and conflicting retry
rejection; rollback; grouped/partial/many-to-many proposals; conflicting evidence,
allocation caps and residual credit; approved aggregates, forecast currency
validation and distinct dates; non-superuser migration and repeat migration.

TDD red stages were observed for missing schema, ingestion tables, payable review,
audit tables and repository contracts before their implementations were added.
The initial Testcontainers environment failure was corrected by using the active
Docker context; tests were not skipped.

Generated details: `build/test-results/test/`, `build/reports/tests/test/`,
`build/reports/jacoco/test/`. No production deployment, live Cognito verification,
cross-database portability exercise or concurrency load test was performed.
