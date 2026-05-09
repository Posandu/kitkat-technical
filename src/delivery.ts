import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { webhooks, webhookDeliveries, alerts as alertsTable } from "./db/schema";

type AlertRow = typeof alertsTable.$inferSelect;

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

async function sendWithRetry(url: string, payload: object): Promise<void> {
	let attempt = 0;
	const body = JSON.stringify(payload);
	
	while (true) {
		attempt++;
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			});
			
			if (res.status >= 200 && res.status < 300) {
				console.log(`[delivery] ✓ Delivered after ${attempt} attempt(s)`);
				return;
			}
			
			if (RETRYABLE_STATUSES.has(res.status)) {
				console.log(`[delivery] Attempt ${attempt}: ${res.status}, retrying immediately...`);
				continue;
			}
			
			console.log(`[delivery] Non-retryable ${res.status}, stopping`);
			return;
		} catch (err) {
			console.log(`[delivery] Attempt ${attempt}: network error, retrying immediately...`);
		}
	}
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

	await sendWithRetry(url, payload);

	await db.insert(webhookDeliveries).values({
		webhookId,
		alertId,
		event,
		deliveredAt: new Date().toISOString(),
	});
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
					{ title: "Fired At", value: alert.firedAt },
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
	try {
		await dispatchToAll(alert, "alert.fired");
	} catch (err) {
		console.error("[delivery] dispatchAlertFired error:", err);
	}
}

export async function dispatchAlertResolved(alert: AlertRow): Promise<void> {
	try {
		await dispatchToAll(alert, "alert.resolved");
	} catch (err) {
		console.error("[delivery] dispatchAlertResolved error:", err);
	}
}
