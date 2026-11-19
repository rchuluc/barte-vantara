# Documentation

| Section | Purpose |
| --- | --- |
| [Architecture decisions](adr/README.md) | Why the main architectural boundaries were chosen, with consequences and references |
| [Guides](guides/README.md) | How to configure, operate and exercise the application |
| [Evidence](evidence/README.md) | What was actually verified, in which environment, and what remained blocked |

Start with the [project README](../README.md) for local development, services,
credentials and delivery. Component-specific references remain beside their code:
[backend](../apps/backend/README.md), [database](../apps/backend/DATABASE.md),
[authorization](../apps/backend/AUTH.md), [frontend](../apps/frontend/README.md)
and [infrastructure](../infra/README.md).

The [development-session index](../ai-development-sessions/README.md) records the
author's review process in PT-BR. Original transcripts preserve the paths used at
the time; operational documentation uses the current paths below.

## Adding documentation

- Add a numbered ADR for an architectural decision, with context, consequences
  and sources. The initial ADRs retrospectively record implemented decisions.
- Put procedures and expected test outcomes in `guides/`; a test recipe alone
  is not evidence that the test passed.
- Put dated observations in `evidence/`, distinguishing local, mocked and live
  checks. Keep blocked or unexecuted steps explicit. Store screenshots in a
  descriptive subdirectory beside the report.
- Update the relevant index and check relative links after moving a document.
