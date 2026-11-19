# ADR-0003: Resolve tenants by hostname from the database

**Status:** Accepted — retrospective record.

## Context and decision

The product needs customer-specific branding without separate application code.
Use registered hostnames to resolve tenants, with branding and domain mappings
stored in PostgreSQL in every environment. Replace the initial development JSON
configuration and reject tenant-prefixed public paths; internal Next.js rewrites
do not make a path slug an alternative tenant selector.

Production provisioning uses a GitHub OIDC-authenticated administrative flow;
local provisioning uses the explicit development seed. Unknown-tenant browser
redirects are configurable, with no hardcoded default.

## Consequences

Development and production share one source of truth, but routing depends on a
healthy backend and valid registration. DNS/TLS setup is still required separately
in production. A matching hostname selects a workspace; only an authenticated,
active membership grants access to its financial data.

## References

- [Tenant provisioning](../guides/tenant-provisioning.md) and [frontend routing](../../apps/frontend/README.md#tenants-and-branding).
- [Session 06](../../ai-development-sessions/06-frontend-foundations/considerations.md).
