# Proxy Maze 26

A continuous proxy-health watchtower built for Torch Labs Sri Lanka. Implements
the spec in full: continuous background probing, singleton alert lifecycle with
re-breach renumbering, retrying webhook delivery, and Slack/Discord
integrations — all on [Elysia](https://elysiajs.com), [Bun](https://bun.sh) and
[`bun:sqlite`](https://bun.sh/docs/api/sqlite) (no ORM).

## Run

```bash
bun install
bun run dev      # hot-reload
bun run start    # plain run
```

The server listens on `http://localhost:6969`. Swagger UI at `/swagger`.

## Layout

```
src/
  index.ts          // Elysia app + boots monitor & delivery worker
  db.ts             // bun:sqlite schema (single-file migrations)
  state.ts          // runtime config snapshot
  util.ts           // ISO time, id-from-url, threshold constants
  monitor.ts        // background sweep loop (real HTTP probes)
  alerts.ts         // breach/recovery state machine
  webhooks.ts       // delivery queue + retry worker (exactly-once per receiver)
  integrations.ts   // Slack + Discord payload builders
  proxies.ts        // pool management + history
  routes/           // HTTP handlers (config, proxies, alerts, webhooks, metrics)
scripts/
  smoke.ts          // end-to-end black-box test
```

## Background loop (the heartbeat)

A self-rescheduling sweep:

1. Read latest `check_interval_seconds`.
2. `Promise.all` of probes per pool entry, each guarded by
   `AbortSignal.timeout(request_timeout_ms)`.
3. **UP** = `2xx` within timeout; **DOWN** = anything else (`5xx`, network,
   timeout, redirect, 4xx).
4. Each result writes to `proxy_history` and updates `proxies` aggregates in a
   single transaction.
5. After the sweep, `evaluateAlerts()` honours the singleton invariant.

No overlapping ticks: the next `setTimeout` is armed only after the current
sweep settles.

## Alert lifecycle

| Condition | Active alert? | Action |
|---|---|---|
| `failure_rate >= 0.20` | none | mint new `alert_id`, fire `alert.fired` |
| `failure_rate >= 0.20` | exists | nothing — same `alert_id` persists |
| `failure_rate <  0.20` | exists | resolve, emit `alert.resolved` |
| `failure_rate <  0.20` | none | nothing |

Resolved alerts are immutable — the row is updated only by the `WHERE
status='active'` resolve guard.

## Webhook delivery

- Registering with `type: "slack"` or `type: "discord"` enables platform-shaped
  payloads. Default is `"generic"`.
- `webhook_deliveries` row carries `(webhook_id, alert_id, event)` UNIQUE,
  giving exactly-once even across restarts.
- Worker retries on `500/502/503/504` and network errors with exponential
  backoff (capped at 30s). Other 4xx mark delivered (spec only mandates retry
  on transient 5xx).
- 10s per-attempt HTTP timeout so a hung receiver can never block the queue.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/config` | latest accepted config |
| POST | `/config` | `{check_interval_seconds, request_timeout_ms}` |
| GET | `/proxies` | watchtower view (latest sweep, no fresh probe) |
| POST | `/proxies` | `{proxies, replace?}` — accepts strings or `{url}` objects |
| GET | `/proxies/:id` | dossier with `total_checks`, `uptime_percentage` |
| GET | `/proxies/:id/history` | full chronicle |
| GET | `/alerts` | `{active, total, alerts}` |
| GET | `/alerts/active` | singleton active alert (404 if none) |
| POST | `/webhooks` | `{url, type?, username?}`; `type ∈ generic|slack|discord` |
| GET | `/webhooks` | list registered receivers |
| GET | `/metrics` | totals + pool snapshot |

Unknown JSON fields are tolerated; only malformed JSON or missing/invalid
required fields produce `400`.

## Smoke test

```bash
bun run smoke
```

Spins up a local target server (with healthy + always-503 endpoints) and a
webhook receiver that fails the first three deliveries with `503`. Drives a
full breach → recovery → re-breach lifecycle and prints assertions.
