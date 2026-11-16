# Unstructured extraction: AI SDK integration

The Next.js server-only service uses AI SDK 7 and the OpenRouter provider to
extract accounts-payable evidence. It does classification and extraction in one
schema-constrained call. It does not expose an HTTP endpoint or write financial
records. Extracted approval/payment statements remain unverified claims.

## Configuration and benchmark

Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `apps/frontend/.env.local`.
The model must support structured outputs. Neither variable is public. Configuration
is loaded at invocation, so builds do not require credentials or network access.

From `apps/frontend`, run `npm run benchmark:unstructured`. This makes four paid
requests using the configured model, one per section of
`data_pack/04_caixa_de_entrada_contas_a_pagar.txt`. It saves the original source,
attempt-start records, results and assertion summary under the gitignored
`artifacts/unstructured/<timestamp>/` directory, with owner-only permissions.
An assertion failure exits nonzero. The fixtures are a small regression benchmark,
not a general accuracy estimate. Review the saved parsed results as well as scores.

Each attempt retains exact source text, source hash, prompt template/version/hash,
schema/version/hash, requested and returned model metadata, generation settings,
raw generated text, validated output, usage, timestamps and outcome. On provider
failure some response information is unavailable. Secrets, response headers and
arbitrary provider error messages are not copied into evidence or console logs.

The service limits input to 64,000 characters, output to 6,000 tokens and calls
to 60 seconds. There are no automatic retries or provider fallbacks. Oversized
input is rejected, never truncated. Failed output is retained when available;
it is never accepted as a partial success. Source quotes are checked for exact
membership. This proves quote presence, not the semantic correctness of the model's
interpretation. Document identifiers retain leading zeros; incomplete dates remain
unresolved. Attachment filenames do not imply access to attachment contents.

## Durable ingestion boundary

`prepareExtraction` creates the attempt envelope; `runExtraction` performs the
call. `extractUnstructured` combines them for callers that already manage evidence.
The benchmark persists the prepared attempt before execution and writes a separate
result afterwards. A crash can therefore leave an identifiable pending attempt.

Production ingestion must persist originals and attempt starts in the existing
authorized, tenant-scoped backend evidence flow before invoking the model, then
persist outcomes before accepting data. Local benchmark files are not that audit
system. The backend remains responsible for validation, authorization, idempotency,
RLS and financial state transitions. Carry `sourceType: unstructured`,
`datasetKind: payable` and `extractionMethod: llm` separately. Persist corrections
as additional evidence rather than overwriting model output. Retain every prompt
and schema version used; increment versions when their behavior changes.

## Verification

`tests/unstructured-extraction.test.ts` covers provenance, malformed output,
fabricated quotes, truncated responses, provider failures, input limits,
configuration and source-instruction isolation. Deterministic tests mock generation;
the benchmark exercises the real provider and the four domain fixtures. A separate
decision model is unnecessary unless classification quality fails on broader cases.
