# ADR-0002: Preserve sources through shared financial ingestion

**Status:** Accepted — retrospective record.

## Context and decision

ERP exports, bank statements and messages can describe overlapping obligations
without establishing the same facts. Preserve source artifacts and locations,
normalize into distinct titles, bank entries and supporting evidence, and record
reconciliation as explicit allocations rather than silently merging records.
Use integer minor units with currency codes, keeping due, booking and value dates
distinct. camt.053 is reference vocabulary, not a compliance claim.

Structured files use preview → confirmation → durable upload/mapping → resumable
processing. The UI drives bounded batches; originals remain in versioned S3 and
corrections do not overwrite source evidence. Agent-prepared payables reuse this
backend pipeline with original text carried in the generated CSV.

## Consequences

Discarded previews are not saved and cannot survive a browser reload. Processing
resumes from persisted progress but requires a client to schedule further batches.
Retry keys prevent duplicate work for the same operation, not semantic duplicates
across separately uploaded sources. Local extraction benchmark artifacts are not
proof that every model attempt is durably audited by the backend.

## References

- [Structured ingestion](../guides/structured-ingestion.md) and [extraction audit boundary](../guides/unstructured-extraction.md).
- [Session 04](../../ai-development-sessions/04-database-foundations/considerations.md), [session 08](../../ai-development-sessions/08-data-ingestion-frontend-integration/considerations.md) and [session 12](../../ai-development-sessions/12-ai-tooling/considerations.md).
