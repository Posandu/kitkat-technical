A proxy monitoring service built with [Elysia](https://elysiajs.com) and [Bun](https://bun.sh), backed by SQLite via [Drizzle ORM](https://orm.drizzle.team).

## Prerequisites

- [Bun](https://bun.sh) v1.0 or later

## Installation

```bash
bun install
```

## Database Setup

Push the schema to the local SQLite database:

```bash
bun run db:push
```

## Running

### Development

Starts the server with hot reload:

```bash
bun run dev
```

### Production

```bash
bun run src/index.ts
```

The server listens on **http://localhost:3000** by default.

### Persistent Discord webhook

Set `DISCORD_WEBHOOK_URL` before starting the app so the Discord integration is seeded on startup and kept in SQLite across restarts.

```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
bun run src/index.ts
```

## API Reference

Interactive Swagger UI is available at:

```
http://localhost:3000/swagger
```

### Endpoints

| Method   | Path                    | Description                              |
| -------- | ----------------------- | ---------------------------------------- |
| `GET`    | `/health`               | Liveness check — returns `{"status":"ok"}` |
| `GET`    | `/config`               | Get active runtime configuration         |
| `POST`   | `/config`               | Update `check_interval_seconds` and `request_timeout_ms` |
| `GET`    | `/proxies`              | List all proxies with pool summary       |
| `POST`   | `/proxies`              | Add proxy URLs to the pool               |
| `DELETE` | `/proxies`              | Clear the proxy pool                     |
| `GET`    | `/proxies/:id`          | Get details for a single proxy           |
| `GET`    | `/proxies/:id/history`  | Get full check history for a proxy       |
| `GET`    | `/alerts`               | List all active and resolved alerts      |
| `POST`   | `/webhooks`             | Register a webhook URL                   |
| `POST`   | `/integrations`         | Register a Slack or Discord integration  |
| `GET`    | `/metrics`              | Global stats (checks, pool size, alerts) |

## Database Scripts

| Command              | Description                          |
| -------------------- | ------------------------------------ |
| `bun run db:push`    | Apply schema changes to `sqlite.db`  |
| `bun run db:studio`  | Open Drizzle Studio (visual DB UI)   |
| `bun run db:destroy` | Delete the `sqlite.db` file entirely |
