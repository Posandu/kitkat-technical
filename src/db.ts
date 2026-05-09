import { Database } from "bun:sqlite";

export const db = new Database("sqlite.db", { create: true });

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    check_interval_seconds INTEGER NOT NULL DEFAULT 15,
    request_timeout_ms INTEGER NOT NULL DEFAULT 3000,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS proxies (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    last_checked_at TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    total_checks INTEGER NOT NULL DEFAULT 0,
    successful_checks INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS proxy_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proxy_id TEXT NOT NULL,
    status TEXT NOT NULL,
    http_status INTEGER,
    latency_ms INTEGER,
    error TEXT,
    checked_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_proxy ON proxy_history(proxy_id, id DESC);

  CREATE TABLE IF NOT EXISTS alerts (
    alert_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,            -- 'active' | 'resolved'
    failure_rate REAL NOT NULL,
    total_proxies INTEGER NOT NULL,
    failed_proxies INTEGER NOT NULL,
    failed_proxy_ids TEXT NOT NULL,  -- JSON array
    threshold REAL NOT NULL,
    fired_at TEXT NOT NULL,
    resolved_at TEXT,
    message TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

  CREATE TABLE IF NOT EXISTS webhooks (
    webhook_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'generic',  -- 'generic' | 'slack' | 'discord'
    username TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id TEXT NOT NULL,
    alert_id TEXT NOT NULL,
    event TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'success' | 'dead'
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    UNIQUE(webhook_id, alert_id, event)
  );
  CREATE INDEX IF NOT EXISTS idx_deliveries_status
    ON webhook_deliveries(status, next_attempt_at);

  CREATE TABLE IF NOT EXISTS metrics_counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );
`);

const counterNames = ["total_checks", "webhook_deliveries", "total_alerts"];
const insertCounter = db.prepare(
	"INSERT OR IGNORE INTO metrics_counters(name, value) VALUES (?, 0)",
);
for (const n of counterNames) insertCounter.run(n);
