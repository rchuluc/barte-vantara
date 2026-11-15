# Frontend instructions

Inherit root AGENTS.md. Node 24, Next.js 16 App Router, TypeScript strict mode,
React and shadcn/ui. Use npm and the checked-in package-lock.json. Run `npm ci`,
`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:coverage`,
and `npm run build`. Use `npm run format` to apply Prettier formatting.

Separate imports, declarations and logical steps with blank lines. Prettier
preserves that spacing; do not compress functions or JSX into dense single lines.

Prefer server components; keep BACKEND_URL private, never NEXT_PUBLIC. Validate
external JSON at the boundary and use bounded requests. Use semantic Tailwind
tokens and shadcn components; compose small components. KISS/DRY, no generic
abstractions for one-off behavior, no `any` or suppressed type errors.

Tests are nonnegotiable. Vitest + Testing Library cover rendered behavior, API
boundaries, malformed responses and failures. Coverage includes all src files:
95% lines, statements, functions and branches. Do not mask the foundation's
coverage backlog with exclusions or threshold changes.

`npm run dev` uses localhost:8080 unless BACKEND_URL overrides it. Never put
credentials into client bundles. `npm run build` must not require a live backend.
Use standalone output, non-root Node runtime, exec-form startup and process health
checks. Build, Trivy scan and run `CI=true dive vantara-frontend:local --ci-config
../../.dive-ci` after changing the Docker image.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
