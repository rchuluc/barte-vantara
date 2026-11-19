# Architecture Decision Records

[Documentation index](../README.md)

These short ADRs retrospectively document decisions already implemented and
discussed in the development sessions. Their numbering is a documentation index,
not the original order of commits; references identify the source decisions.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-identity-and-database-authorization.md) | Separate Cognito identity from PostgreSQL authorization | Accepted |
| [0002](0002-source-preserving-financial-ingestion.md) | Preserve source evidence and normalize through shared ingestion | Accepted |
| [0003](0003-database-backed-hostname-tenancy.md) | Resolve tenant branding by hostname from the database | Accepted |
| [0004](0004-delegated-agents-and-human-review.md) | Delegate user-scoped agent work while reserving financial review for humans | Accepted |

For a new decision, use the next four-digit number and a descriptive filename.
Keep context, decision, consequences and references concise. Use `Proposed` until
accepted; when replacing an accepted decision, add a new ADR and mark the old one
as superseded with a link. Verification results belong in [evidence](../evidence/README.md).
