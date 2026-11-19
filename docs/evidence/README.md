# Verification evidence

[Documentation index](../README.md)

These are historical observations, not a statement that every check passes on
the current revision. Each report retains its original scope and limitations.

| Date | Report | Environment and outcome |
| --- | --- | --- |
| 2026-11-13 | [Foundation verification](verification.md) | Local application, database and static infrastructure checks; image-scan limitations recorded |
| 2026-11-18 | [Reconciliation walkthrough](reconciliation-flow-evidence-2026-11-18.md) | Complete local UI import/proposal/independent-review flow passed; local MCP blocked with 503 |
| 2026-11-18 | [Live MCP reconciliation](reconciliation-live-mcp-evidence-2026-11-18.md) | Live authentication, reads and proposal passed; independent approval not executed and matching limitation recorded |

The live report links to its [proposal screenshot](live-mcp-2026-11-18/proposal-awaiting-review.png).
It does not claim successful production settlement. Local UI approval is a
separate result, not a substitute for the missing live reviewer step.

Add new runs as separate dated reports, recording the environment, revision when
known, actions, observed results and remaining blockers. Do not include credentials
or bearer tokens. Procedures without execution results belong in [guides](../guides/README.md).
