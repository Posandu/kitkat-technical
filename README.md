Proxy Maze Core Engine (Bun + Elysia + SQLite + Drizzle)

Stack
- Runtime: Bun 1.0+
- API: ElysiaJS
- Docs: @elysiajs/swagger
- Database: SQLite (sqlite.db)
- ORM: Drizzle
- Background processing: Bun async loop (setInterval + Promise.allSettled)
- Network: native fetch + AbortSignal

Setup
1. Install Bun: https://bun.sh
2. Install dependencies:
   bun install
3. Copy env file:
   cp .env.bun.example .env
4. Create/update DB schema:
   bun run db:push
5. Run service:
   bun run dev

API
- POST /integrations
- POST /webhooks
- GET /health
- Swagger UI: /swagger

Behavior
- /webhooks validates body with Elysia schema.
- Builds standard payload for alert.fired and alert.resolved.
- Builds Slack attachments (hex colors + unix epoch ts) and Discord embeds (integer colors).
- Persists queued event in SQLite and delivers asynchronously via Bun event loop.
- Retries transient failures with exponential backoff.

Pairing with the main project
- Use POST /proxy-targets to register monitored proxy URLs.
- Use PATCH /config to change cadence, request timeout, and failure threshold immediately.
- Use GET /state to read the canonical monitoring state shared by the API and webhooks.
- Use POST /integrations to register Slack and Discord receivers.
- Consume alert.fired and alert.resolved from the registered receivers.

Watchman loop
- Reads active proxy targets from SQLite.
- Probes concurrently with Promise.allSettled.
- Uses fetch + AbortSignal timeout.
- Persists check history and alert archive.
