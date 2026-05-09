import { and, eq } from "drizzle-orm";
import { db } from "./db";
import {
	webhooks,
	webhookDeliveries,
	alerts as alertsTable,
} from "./db/schema";

type AlertRow = typeof alertsTable.$inferSelect;

const WEBHOOK_TIMEOUT_MS = 10_000;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const TRANSIENT_FAILURES = new Set([500, 502, 503, 504]);

const STATIC_DISCORD_WEBHOOK_URL =
	process.env.DISCORD_WEBHOOK_URL ??
	"https://discord.com/api/webhooks/1502580067061071902/QdRIzAC0AOnuCYSAcGFWR1iV7U_BT-3Y66_05S5pKVBcxMkLP3rPE-OJNdUP6sb-RNGR";
const STATIC_DISCORD_WEBHOOK_ID = "wh-static-discord";

function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

function isRetryableStatus(status: number): boolean {
	return TRANSIENT_FAILURES.has(status);
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

	while (true) {
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
			await sleep(delay);
			delay = Math.min(delay * 2, MAX_DELAY_MS);
			continue;
		}
		clearTimeout(timer);

		if (res.status >= 200 && res.status < 300) return true;

		if (!isRetryableStatus(res.status)) {
			console.error(
				`[delivery] ${url}: non-retryable status ${res.status}`,
			);
			return false;
		}

		lastError = `status ${res.status}`;

		const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
		await sleep(retryAfter ?? delay);
		delay = Math.min(delay * 2, MAX_DELAY_MS);
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

function discordFired(alert: AlertRow, username?: string | null) {
	const ids = parsedIds(alert);
	const payload: any = {
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
	if (username) payload.username = username;
	return payload;
}

function discordResolved(alert: AlertRow, username?: string | null) {
	const ids = parsedIds(alert);
	const payload: any = {
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
	if (username) payload.username = username;
	return payload;
}

// ── Public dispatch functions ───────────────────────────────────────────────

async function dispatchToAll(
	alert: AlertRow,
	event: "alert.fired" | "alert.resolved",
) {
	const allWebhooks = await db.select().from(webhooks);

	const dbDispatches = allWebhooks.map(async (wh) => {
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
					? discordFired(alert, wh.username)
					: discordResolved(alert, wh.username);
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
	});

	const staticDiscordPayload =
		event === "alert.fired" ? discordFired(alert, "ProxyWatch") : discordResolved(alert, "ProxyWatch");
	const staticDispatch = (async () => {
		try {
			await deliver(
				STATIC_DISCORD_WEBHOOK_ID,
				STATIC_DISCORD_WEBHOOK_URL,
				alert.alertId,
				event,
				staticDiscordPayload,
			);
		} catch (err) {
			console.error(
				`[delivery] ${event} → ${STATIC_DISCORD_WEBHOOK_ID} failed:`,
				err,
			);
		}
	})();

	await Promise.all([...dbDispatches, staticDispatch]);
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
