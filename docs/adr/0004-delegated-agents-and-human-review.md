# ADR-0004: Delegate agent work, retain independent human review

**Status:** Accepted — retrospective record.

## Context and decision

Employees should use agents to extract data, search records and propose matches
without giving a connector tenant-wide authority or allowing AI to approve
financial actions. MCP authenticates each employee through a dedicated Cognito
OIDC client with PKCE and resource-bound tokens. Requests recheck the employee's
database scopes and are classified as AI-originated by verified authentication.

Agent reconciliation proposals remain pending and do not change balances. A
different authorized human approves or rejects in the UI. The platform chat uses
a signed confirmation step for payable imports; MCP import confirmation belongs
to the MCP host and is not represented as a verified platform-button approval.

## Consequences

The same financial authorization applies to UI and agent access, with an additional
restriction on delegated approval. No MCP approval tool exists. A working web login
does not imply an MCP session, and Floci cannot support the full resource-bound
login flow. End-to-end testing therefore needs real Cognito and an independent
reviewer; successful proposal creation alone does not establish settlement.

## References

- [MCP authentication and imports](../guides/mcp-imports.md) and [reconciliation tools](../guides/mcp-reconciliation.md).
- [Session 13](../../ai-development-sessions/13-mcp/considerations.md) and [session 14](../../ai-development-sessions/14-mcp-read-tools/considerations.md).
- [Live evidence and approval limitation](../evidence/reconciliation-live-mcp-evidence-2026-11-18.md).
