import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { webhooks, webhookDeliveries, alerts as alertsTable } from "./db/schema";

type AlertRow = typeof alertsTable.$inferSelect;

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

async function sendWithRetry(url: string, payload: object): Promise<boolean> {
	let attempt = 0;
	const body = JSON.stringify(payload);
	const startTime = Date.now();
	const TIMEOUT_MS = 60_000; // 60 second timeout
	let delayMs = 50; // Start with 50ms
	const MAX_DELAY_MS = 5000; // Cap at 5 seconds
	
	console.log(`[delivery] Sending to ${url}`);
	console.log(`[delivery] Payload:`, body);
	
	while (Date.now() - startTime < TIMEOUT_MS) {
		attempt++;
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			});
			
			if (res.status >= 200 && res.status < 300) {
				console.log(`[delivery] ✓ Delivered after ${attempt} attempt(s) in ${Date.now() - startTime}ms`);
				return true;
			}
			
			// Log 5xx errors explicitly - they're retryable
			if (res.status >= 500) {
				if (attempt % 20 === 1) {
					console.log(`[delivery] Attempt ${attempt}: ${res.status} (5xx - retrying), elapsed ${Date.now() - startTime}ms`);
				}
			} else if (attempt % 100 === 0) {
				console.log(`[delivery] Attempt ${attempt}: ${res.status}, elapsed ${Date.now() - startTime}ms`);
			}
		} catch (err) {
			if (attempt % 100 === 0) {
				console.log(`[delivery] Attempt ${attempt}: network error, elapsed ${Date.now() - startTime}ms`);
			}
		}
		
		// Exponential backoff: 50ms, 100ms, 200ms, 400ms, 800ms, up to 5 seconds
		await sleep(delayMs);
		delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
	}
	
	console.log(`[delivery] ⚠ Timed out after ${attempt} attempts in 60s`);
	return false;
}

async function deliver(
	webhookId: string,
	url: string,
	alertId: string,
	event: string,
	payload: object,
): Promise<void> {
	const [existing] = await db
		.select()
		.from(webhookDeliveries)
		.where(
			and(
				eq(webhookDeliveries.webhookId, webhookId),
				eq(webhookDeliveries.alertId, alertId),
				eq(webhookDeliveries.event, event),
			),
		)
		.limit(1);

	if (existing) {
		console.log(`[delivery] Skipped duplicate: ${webhookId}/${event}`);
		return;
	}

	const success = await sendWithRetry(url, payload);
	
	if (success) {
		await db.insert(webhookDeliveries).values({
			webhookId,
			alertId,
			event,
			deliveredAt: new Date().toISOString(),
		});
	} else {
		console.log(`[delivery] Failed permanently, not recording: ${webhookId}/${event}`);
	}
}

// ── Payload builders ────────────────────────────────────────────────────────

function parsedIds(alert: AlertRow): string[] {
	try {
		return JSON.parse(alert.failedProxyIds) as string[];
	} catch {
		return [];
	}
}

function standardFired(alert: AlertRow) {
	return {
		event: "alert.fired",
		alert_id: alert.alertId,
		fired_at: alert.firedAt,
		failure_rate: alert.failureRate,
		total_proxies: alert.totalProxies,
		failed_proxies: alert.failedProxies,
		failed_proxy_ids: parsedIds(alert),
		threshold: alert.threshold,
		message: alert.message,
	};
}

function standardResolved(alert: AlertRow) {
	return {
		event: "alert.resolved",
		alert_id: alert.alertId,
		resolved_at: alert.resolvedAt,
		failure_rate: alert.failureRate,
		total_proxies: alert.totalProxies,
		failed_proxies: alert.failedProxies,
		failed_proxy_ids: parsedIds(alert),
		threshold: alert.threshold,
		message: alert.message,
	};
}

function slackFired(alert: AlertRow, username: string) {
	const ids = parsedIds(alert);
	return {
		username,
		text: `Alert fired: ${alert.message}`,
		attachments: [
			{
				color: "#FF0000",
				fields: [
					{ title: "Alert ID", value: alert.alertId },
					{ title: "Failure Rate", value: `${(alert.failureRate * 100).toFixed(1)}%` },
					{ title: "Failed Proxies", value: String(alert.failedProxies) },
					{ title: "Threshold", value: `${(alert.threshold * 100).toFixed(1)}%` },
					{ title: "Failed IDs", value: ids.join(", ") || "none" },
					{ title: "Fired At", value: alert.firedAt },
				],
				footer: "ProxyMaze Monitor",
				ts: Math.floor(new Date(alert.firedAt).getTime() / 1000),
			},
		],
	};
}

function slackResolved(alert: AlertRow, username: string) {
	const ids = parsedIds(alert);
	return {
		username,
		text: `Alert resolved: ${alert.message}`,
		attachments: [
			{
				color: "#36A64F",
				fields: [
					{ title: "Alert ID", value: alert.alertId },
					{ title: "Failure Rate", value: `${(alert.failureRate * 100).toFixed(1)}%` },
					{ title: "Failed Proxies", value: String(alert.failedProxies) },
					{ title: "Threshold", value: `${(alert.threshold * 100).toFixed(1)}%` },
					{ title: "Failed IDs", value: ids.join(", ") || "none" },
					{ title: "Resolved At", value: alert.resolvedAt ?? "pending" },
				],
				footer: "ProxyMaze Monitor",
				ts: Math.floor(new Date(alert.resolvedAt ?? alert.firedAt).getTime() / 1000),
			},
		],
	};
}

function discordFired(alert: AlertRow) {
	const ids = parsedIds(alert);
	return {
		embeds: [
			{
				title: "Alert Fired",
				description: alert.message,
				color: 16711680,
				fields: [
					{ name: "Alert ID", value: alert.alertId },
					{ name: "Failure Rate", value: `${(alert.failureRate * 100).toFixed(1)}%` },
					{ name: "Failed Proxies", value: String(alert.failedProxies) },
					{ name: "Threshold", value: `${(alert.threshold * 100).toFixed(1)}%` },
					{ name: "Failed IDs", value: ids.join(", ") || "none" },
				],
				footer: { text: "ProxyMaze Monitor" },
			},
		],
	};
}

function discordResolved(alert: AlertRow) {
	const ids = parsedIds(alert);
	return {
		embeds: [
			{
				title: "Alert Resolved",
				description: `Alert ${alert.alertId} has been resolved`,
				color: 3580392,
				fields: [
					{ name: "Alert ID", value: alert.alertId },
					{ name: "Failure Rate", value: `${(alert.failureRate * 100).toFixed(1)}%` },
					{ name: "Failed Proxies", value: String(alert.failedProxies) },
					{ name: "Threshold", value: `${(alert.threshold * 100).toFixed(1)}%` },
					{ name: "Failed IDs", value: ids.join(", ") || "none" },
				],
				footer: { text: "ProxyMaze Monitor" },
			},
		],
	};
}

// ── Public dispatch functions ───────────────────────────────────────────────

async function dispatchToAll(alert: AlertRow, event: "alert.fired" | "alert.resolved") {
	const allWebhooks = await db.select().from(webhooks);
	console.log(`[delivery] Dispatching ${event} to ${allWebhooks.length} webhook(s)`);

	await Promise.all(
		allWebhooks.map(async (wh) => {
			if (wh.type !== "standard" && wh.events) {
				const allowed = JSON.parse(wh.events) as string[];
				if (!allowed.includes(event)) {
					return;
				}
			}

			let payload: object;
			if (wh.type === "slack") {
				payload =
					event === "alert.fired"
						? slackFired(alert, wh.username ?? "ProxyWatch")
						: slackResolved(alert, wh.username ?? "ProxyWatch");
			} else if (wh.type === "discord") {
				payload = event === "alert.fired" ? discordFired(alert) : discordResolved(alert);
			} else {
				payload = event === "alert.fired" ? standardFired(alert) : standardResolved(alert);
			}

			try {
				await deliver(wh.webhookId, wh.url, alert.alertId, event, payload);
			} catch (err) {
				console.error(`[delivery] Failed ${wh.webhookId}:`, err);
			}
		}),
	);
}

export async function dispatchAlertFired(alert: AlertRow): Promise<void> {
	await dispatchToAll(alert, "alert.fired").catch((err) =>
		console.error("[delivery] dispatchAlertFired error:", err)
	);
}

export async function dispatchAlertResolved(alert: AlertRow): Promise<void> {
	await dispatchToAll(alert, "alert.resolved").catch((err) =>
		console.error("[delivery] dispatchAlertResolved error:", err)
	);
}
