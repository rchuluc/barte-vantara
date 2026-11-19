# ADR-0001: Separate identity from database authorization

**Status:** Accepted — retrospective record.

## Context and decision

One person can belong to multiple tenants with different roles and financial
scopes. Cognito verifies identity, while PostgreSQL owns memberships, roles,
business-unit/account access and separate approval grants. The trusted backend
validates tokens and establishes transaction-local context; forced RLS and
tenant-aware constraints enforce database boundaries.

Repository contracts keep the core independent of JDBC and PostgreSQL-specific
adapters. This supports replacing persistence code without claiming that SQL
migrations or the security model are portable to another database unchanged.

## Consequences

Role changes apply on subsequent requests instead of waiting for token renewal.
Technical administration does not imply financial authority. RLS depends on the
trusted service boundary: session settings do not verify Cognito tokens and are
not protection against an attacker allowed to execute arbitrary SQL as the runtime.

## References

- [Database contract](../../apps/backend/DATABASE.md) and [authorization](../../apps/backend/AUTH.md).
- [Session 04](../../ai-development-sessions/04-database-foundations/considerations.md) and [session 05](../../ai-development-sessions/05-user-management/considerations.md).
