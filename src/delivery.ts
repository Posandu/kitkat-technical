import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { webhooks, webhookDeliveries, alerts as alertsTable } from "./db/schema";

type AlertRow = typeof alertsTable.$inferSelect;

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

async function sendWithRetry(url: string, payload: object): Promise<void> {
	const delay = 5_000;
	let attempt = 0;
	while (true) {
		attempt++;
		console.log(`[delivery] Attempt ${attempt} to ${url}`);
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			console.log(`[delivery] Received status ${res.status} from ${url}`);
			if (res.status >= 200 && res.status < 300) {
				console.log(`[delivery] Success on attempt ${attempt}`);
				return;
			}
			if (RETRYABLE_STATUSES.has(res.status)) {
				console.log(`[delivery] Retryable status ${res.status}, waiting ${delay}ms before retry`);
				await sleep(delay);
				continue;
			}
			console.log(`[delivery] Non-retryable status ${res.status}, giving up`);
			return;
		} catch (err) {
			console.log(`[delivery] Network error on attempt ${attempt}:`, err);
			await sleep(delay);
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
		console.log(`[delivery] Skipping duplicate delivery: webhook=${webhookId}, alert=${alertId}, event=${event}`);
		return;
	}

	console.log(`[delivery] Sending to ${url}`);
	await sendWithRetry(url, payload);

	await db.insert(webhookDeliveries).values({
		webhookId,
		alertId,
		event,
		deliveredAt: new Date().toISOString(),
	});
	console.log(`[delivery] Recorded delivery: webhook=${webhookId}, alert=${alertId}, event=${event}`);
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
	console.log(`[delivery] Found ${allWebhooks.length} webhooks for event ${event}`);

	await Promise.all(
		allWebhooks.map(async (wh) => {
			console.log(`[delivery] Processing webhook ${wh.webhookId}, type: ${wh.type}, events: ${wh.events}`);
			
			if (wh.type !== "standard" && wh.events) {
				const allowed = JSON.parse(wh.events) as string[];
				console.log(`[delivery] Checking event filter: allowed=${JSON.stringify(allowed)}, event=${event}`);
				if (!allowed.includes(event)) {
					console.log(`[delivery] Event ${event} not in allowed list, skipping webhook ${wh.webhookId}`);
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

			console.log(`[delivery] Delivering ${event} to ${wh.webhookId} at ${wh.url}`);
			try {
				await deliver(wh.webhookId, wh.url, alert.alertId, event, payload);
				console.log(`[delivery] Successfully delivered ${event} to ${wh.webhookId}`);
			} catch (err) {
				console.error(`[delivery] ${event} → ${wh.webhookId} failed:`, err);
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
