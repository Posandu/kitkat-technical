import { sqliteTable, text, int, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const config = sqliteTable("config", {
	id: int("id").primaryKey({ autoIncrement: true }),
	checkIntervalSeconds: int("check_interval_seconds").notNull().default(15),
	requestTimeoutMs: int("request_timeout_ms").notNull().default(3000),
});

export const proxies = sqliteTable("proxies", {
	id: text("id").primaryKey(),
	url: text("url").notNull(),
	status: text("status").notNull().default("pending"),
	lastCheckedAt: text("last_checked_at"),
	consecutiveFailures: int("consecutive_failures").notNull().default(0),
});

export const proxyHistory = sqliteTable("proxy_history", {
	id: int("id").primaryKey({ autoIncrement: true }),
	proxyId: text("proxy_id").notNull(),
	status: text("status").notNull(),
	checkedAt: text("checked_at").notNull(),
});

export const alerts = sqliteTable("alerts", {
	alertId: text("alert_id").primaryKey(),
	status: text("status").notNull(),
	failureRate: real("failure_rate").notNull(),
	totalProxies: int("total_proxies").notNull(),
	failedProxies: int("failed_proxies").notNull(),
	failedProxyIds: text("failed_proxy_ids").notNull(),
	threshold: real("threshold").notNull().default(0.2),
	firedAt: text("fired_at").notNull(),
	resolvedAt: text("resolved_at"),
	message: text("message").notNull(),
});

export const webhooks = sqliteTable("webhooks", {
	webhookId: text("webhook_id").primaryKey(),
	url: text("url").notNull(),
	type: text("type").notNull().default("standard"),
	username: text("username"),
	events: text("events"),
});

export const webhookDeliveries = sqliteTable(
	"webhook_deliveries",
	{
		id: int("id").primaryKey({ autoIncrement: true }),
		webhookId: text("webhook_id").notNull(),
		alertId: text("alert_id").notNull(),
		event: text("event").notNull(),
		status: text("status").notNull().default("pending"),
		payload: text("payload").notNull(),
		url: text("url").notNull(),
		attempts: int("attempts").notNull().default(0),
		createdAt: text("created_at").notNull(),
		deliveredAt: text("delivered_at"),
	},
	(t) => [
		uniqueIndex("uniq_webhook_alert_event").on(t.webhookId, t.alertId, t.event),
	],
);
