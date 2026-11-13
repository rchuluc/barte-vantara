# Frontend

Next.js 16 App Router, React, strict TypeScript, Tailwind 4 and shadcn/ui Card.
The dynamic server-rendered home page calls the backend `/api/hello` route with
a 5-second timeout. Failures show a neutral unavailable message. BACKEND_URL is
server-only; no browser CORS setup is necessary.

```sh
npm ci
npm run dev             # http://localhost:3000; backend defaults to :8080
npm run lint
npm run format          # Prettier formatting
npm run format:check    # required in CI and pre-commit
npm run typecheck
npm test                # Vitest behavior tests
npm run test:coverage   # 95% lines/branches/functions/statements, all src files
npm run build
```

Run the root Compose stack first for database/backend development. To run just
the Next.js dev server, stop the Compose frontend to free port 3000. The complete
containerized path is `docker compose up -d --build` at the repository root.

`/api/health` is a process health probe, deliberately independent of backend
availability so a backend outage does not restart every frontend task.
The home page provides the full-stack integration check.

Standalone production output is built in a separate Docker stage. The Node
runtime runs as UID 1000, receives SIGTERM directly (with init in Compose/ECS),
and has a read-only root filesystem. All pages requiring backend data are dynamic,
so the image build needs no database/backend. Coverage reports live in `coverage/`.

`src/instrumentation.ts` registers OpenTelemetry with `@vercel/otel`; ECS exports
OTLP to the Datadog sidecar. Use the shadcn CLI for new components and keep local
imports under `@/`. Do not introduce secrets or private API URLs into client code.
