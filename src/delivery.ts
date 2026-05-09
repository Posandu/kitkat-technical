import { and, eq } from "drizzle-orm";
import { db } from "./db";
import {
	webhooks,
	webhookDeliveries,
	alerts as alertsTable,
} from "./db/schema";

type AlertRow = typeof alertsTable.$inferSelect;

const WEBHOOK_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const EXPLICIT_RETRYABLE_STATUSES = new Set([408, 429]);

function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

function isRetryableStatus(status: number): boolean {
	return status >= 500 || EXPLICIT_RETRYABLE_STATUSES.has(status);
}

function parseRetryAfter(header: string | null): number | null {
	if (!header) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.min(seconds * 1000, MAX_DELAY_MS);
	}
	const dateMs = Date.parse(header);
	if (Number.isFinite(dateMs)) {
		return Math.max(0, Math.min(dateMs - Date.now(), MAX_DELAY_MS));
	}
	return null;
}

async function sendWithRetry(url: string, payload: object): Promise<boolean> {
	let delay = BASE_DELAY_MS;
	let lastError = "unknown error";

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

		let res: Response;
		try {
			res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				signal: controller.signal,
			});
		} catch (err) {
			clearTimeout(timer);
			lastError =
				err instanceof Error ? `${err.name}: ${err.message}` : String(err);
			if (attempt === MAX_ATTEMPTS) break;
			await sleep(delay);
			delay = Math.min(delay * 2, MAX_DELAY_MS);
			continue;
		}
		clearTimeout(timer);

		if (res.status >= 200 && res.status < 300) return true;

		if (!isRetryableStatus(res.status)) {
			console.error(
				`[delivery] ${url}: non-retryable status ${res.status} on attempt ${attempt}`,
			);
			return false;
		}

		lastError = `status ${res.status}`;
		if (attempt === MAX_ATTEMPTS) break;

		const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
		await sleep(retryAfter ?? delay);
		delay = Math.min(delay * 2, MAX_DELAY_MS);
	}

	console.error(
		`[delivery] ${url}: failed after ${MAX_ATTEMPTS} attempts: ${lastError}`,
	);
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

	if (existing) return;

	const ok = await sendWithRetry(url, payload);
	if (!ok) return;

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
					{
						title: "Failure Rate",
						value: `${(alert.failureRate * 100).toFixed(1)}%`,
					},
					{ title: "Failed Proxies", value: String(alert.failedProxies) },
					{
						title: "Threshold",
						value: `${(alert.threshold * 100).toFixed(1)}%`,
					},
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
					{
						title: "Failure Rate",
						value: `${(alert.failureRate * 100).toFixed(1)}%`,
					},
					{ title: "Failed Proxies", value: String(alert.failedProxies) },
					{
						title: "Threshold",
						value: `${(alert.threshold * 100).toFixed(1)}%`,
					},
					{ title: "Failed IDs", value: ids.join(", ") || "none" },
					{ title: "Fired At", value: alert.firedAt },
				],
				footer: "ProxyMaze Monitor",
				ts: Math.floor(
					new Date(alert.resolvedAt ?? alert.firedAt).getTime() / 1000,
				),
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
					{
						name: "Failure Rate",
						value: `${(alert.failureRate * 100).toFixed(1)}%`,
					},
					{ name: "Failed Proxies", value: String(alert.failedProxies) },
					{
						name: "Threshold",
						value: `${(alert.threshold * 100).toFixed(1)}%`,
					},
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
					{
						name: "Failure Rate",
						value: `${(alert.failureRate * 100).toFixed(1)}%`,
					},
					{ name: "Failed Proxies", value: String(alert.failedProxies) },
					{
						name: "Threshold",
						value: `${(alert.threshold * 100).toFixed(1)}%`,
					},
					{ name: "Failed IDs", value: ids.join(", ") || "none" },
				],
				footer: { text: "ProxyMaze Monitor" },
			},
		],
	};
}

// ── Public dispatch functions ───────────────────────────────────────────────

async function dispatchToAll(
	alert: AlertRow,
	event: "alert.fired" | "alert.resolved",
) {
	const allWebhooks = await db.select().from(webhooks);

	await Promise.all(
		allWebhooks.map(async (wh) => {
			if (wh.events) {
				const allowed = JSON.parse(wh.events) as string[];
				if (!allowed.includes(event)) return;
			}

			let payload: object;
			if (wh.type === "slack") {
				payload =
					event === "alert.fired"
						? slackFired(alert, wh.username ?? "ProxyWatch")
						: slackResolved(alert, wh.username ?? "ProxyWatch");
			} else if (wh.type === "discord") {
				payload =
					event === "alert.fired"
						? discordFired(alert)
						: discordResolved(alert);
			} else {
				payload =
					event === "alert.fired"
						? standardFired(alert)
						: standardResolved(alert);
			}

			try {
				await deliver(wh.webhookId, wh.url, alert.alertId, event, payload);
			} catch (err) {
				console.error(`[delivery] ${event} → ${wh.webhookId} failed:`, err);
			}
		}),
	);
}

export function dispatchAlertFired(alert: AlertRow): void {
	dispatchToAll(alert, "alert.fired").catch((err) =>
		console.error("[delivery] dispatchAlertFired error:", err),
	);
}

export function dispatchAlertResolved(alert: AlertRow): void {
	dispatchToAll(alert, "alert.resolved").catch((err) =>
		console.error("[delivery] dispatchAlertResolved error:", err),
	);
}
