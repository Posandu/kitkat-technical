import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["slack", "discord"] }).notNull(),
  webhookUrl: text("webhook_url").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
});

export const runtimeConfig = sqliteTable("runtime_config", {
  id: text("id").primaryKey(),
  cadenceMs: integer("cadence_ms").notNull(),
  requestTimeoutMs: integer("request_timeout_ms").notNull(),
  failureThreshold: real("failure_threshold").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  integrationId: text("integration_id").notNull(),
  correlationId: text("correlation_id"),
  eventType: text("event_type", { enum: ["alert.fired", "alert.resolved"] }).notNull(),
  payloadJson: text("payload_json").notNull(),
  providerPayloadJson: text("provider_payload_json").notNull(),
  status: text("status", { enum: ["queued", "delivered", "failed"] }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  errorMessage: text("error_message")
});

export const proxyTargets = sqliteTable("proxy_targets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  checkIntervalSeconds: integer("check_interval_seconds").notNull().default(30),
  timeoutMs: integer("timeout_ms").notNull().default(5000),
  expectedStatus: integer("expected_status").notNull().default(200),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});

export const proxyTargetStates = sqliteTable("proxy_target_states", {
  targetId: text("target_id").primaryKey(),
  status: text("status", { enum: ["pending", "up", "down"] }).notNull(),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  lastStatusCode: integer("last_status_code"),
  lastLatencyMs: integer("last_latency_ms"),
  lastErrorMessage: text("last_error_message"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});

export const checkHistory = sqliteTable("check_history", {
  id: text("id").primaryKey(),
  targetId: text("target_id").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms").notNull(),
  errorMessage: text("error_message"),
  checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull()
});

export const alertArchive = sqliteTable("alert_archive", {
  id: text("id").primaryKey(),
  targetId: text("target_id").notNull(),
  correlationId: text("correlation_id"),
  eventType: text("event_type", { enum: ["alert.fired", "alert.resolved"] }).notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  payloadJson: text("payload_json").notNull(),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull()
});

export const poolIncidents = sqliteTable("pool_incidents", {
  id: text("id").primaryKey(),
  status: text("status", { enum: ["open", "resolved"] }).notNull(),
  failureRate: real("failure_rate").notNull(),
  threshold: real("threshold").notNull(),
  downCount: integer("down_count").notNull(),
  totalCount: integer("total_count").notNull(),
  openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});
