import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { webhooks, webhookDeliveries, alerts as alertsTable } from "./db/schema";

type AlertRow = typeof alertsTable.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;
type WebhookRow = typeof webhooks.$inferSelect;

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const FETCH_TIMEOUT_MS = 5_000;
const INITIAL_RETRY_MS = 250;
const MAX_RETRY_MS = 2_500;

function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

async function singleAttempt(
	url: string,
	body: string,
): Promise<{ ok: true } | { ok: false; retryable: boolean }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			signal: controller.signal,
		});
		if (RETRYABLE_STATUSES.has(res.status)) {
			return { ok: false, retryable: true };
		}
		return { ok: true };
	} catch {
		return { ok: false, retryable: true };
	} finally {
		clearTimeout(timer);
	}
}

async function processDelivery(row: DeliveryRow): Promise<void> {
	let delay = INITIAL_RETRY_MS;
	let attempts = row.attempts;

	while (true) {
		attempts += 1;
		const result = await singleAttempt(row.url, row.payload);

		if (result.ok) {
			await db
				.update(webhookDeliveries)
				.set({
					status: "delivered",
					attempts,
					deliveredAt: new Date().toISOString(),
				})
				.where(eq(webhookDeliveries.id, row.id));
			return;
		}

		await db
			.update(webhookDeliveries)
			.set({ attempts })
			.where(eq(webhookDeliveries.id, row.id));

		await sleep(delay);
		delay = Math.min(delay * 2, MAX_RETRY_MS);
	}
}

const inFlight = new Set<number>();
const webhookChains = new Map<string, Promise<void>>();

// Serialize deliveries within a single webhook so a slow retry on a "fired"
// event can't be overtaken by a later "resolved" event. The spec mandates the
// receiver observes fired (prior) -> resolved (prior) -> fired (new) in order.
function spawnDelivery(row: DeliveryRow): void {
	if (inFlight.has(row.id)) return;
	inFlight.add(row.id);

	const prev = webhookChains.get(row.webhookId) ?? Promise.resolve();
	const next = prev
		.catch(() => undefined)
		.then(() => processDelivery(row))
		.catch((err) =>
			console.error(`[delivery] worker ${row.id} crashed:`, err),
		)
		.finally(() => inFlight.delete(row.id));

	webhookChains.set(row.webhookId, next);
}

export async function resumePendingDeliveries(): Promise<void> {
	const rows = await db
		.select()
		.from(webhookDeliveries)
		.where(eq(webhookDeliveries.status, "pending"));
	for (const row of rows) spawnDelivery(row);
}

function parsedIds(alert: AlertRow): string[] {
	try {
		const parsed = JSON.parse(alert.failedProxyIds);
		return Array.isArray(parsed) ? parsed : [];
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

function fmtPct(rate: number): string {
	return `${(rate * 100).toFixed(1)}%`;
}

function slackFired(alert: AlertRow, username: string) {
	const ids = parsedIds(alert);
	return {
		username,
		text: `Proxy pool failure rate exceeded threshold (${fmtPct(alert.failureRate)})`,
		attachments: [
			{
				color: "#FF0000",
				fields: [
					{ title: "Alert ID", value: alert.alertId },
					{ title: "Failure Rate", value: fmtPct(alert.failureRate) },
					{ title: "Failed Proxies", value: `${alert.failedProxies}/${alert.totalProxies}` },
					{ title: "Threshold", value: fmtPct(alert.threshold) },
					{ title: "Failed IDs", value: ids.length ? ids.join(", ") : "none" },
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
	const tsSource = alert.resolvedAt ?? alert.firedAt;
	return {
		username,
		text: `Proxy pool recovered (failure rate ${fmtPct(alert.failureRate)})`,
		attachments: [
			{
				color: "#36A64F",
				fields: [
					{ title: "Alert ID", value: alert.alertId },
					{ title: "Failure Rate", value: fmtPct(alert.failureRate) },
					{ title: "Failed Proxies", value: `${alert.failedProxies}/${alert.totalProxies}` },
					{ title: "Threshold", value: fmtPct(alert.threshold) },
					{ title: "Failed IDs", value: ids.length ? ids.join(", ") : "none" },
					{ title: "Fired At", value: alert.firedAt },
				],
				footer: "ProxyMaze Monitor",
				ts: Math.floor(new Date(tsSource).getTime() / 1000),
			},
		],
	};
}

function discordFired(alert: AlertRow) {
	const ids = parsedIds(alert);
	return {
		embeds: [
			{
				title: "Proxy Pool Alert Fired",
				description: `Failure rate ${fmtPct(alert.failureRate)} exceeded threshold ${fmtPct(alert.threshold)}.`,
				color: 0xff0000,
				fields: [
					{ name: "Alert ID", value: alert.alertId },
					{ name: "Failure Rate", value: fmtPct(alert.failureRate) },
					{ name: "Failed Proxies", value: `${alert.failedProxies}/${alert.totalProxies}` },
					{ name: "Threshold", value: fmtPct(alert.threshold) },
					{ name: "Failed IDs", value: ids.length ? ids.join(", ") : "none" },
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
				title: "Proxy Pool Alert Resolved",
				description: `Failure rate dropped to ${fmtPct(alert.failureRate)}, below threshold ${fmtPct(alert.threshold)}.`,
				color: 0x36a64f,
				fields: [
					{ name: "Alert ID", value: alert.alertId },
					{ name: "Failure Rate", value: fmtPct(alert.failureRate) },
					{ name: "Failed Proxies", value: `${alert.failedProxies}/${alert.totalProxies}` },
					{ name: "Threshold", value: fmtPct(alert.threshold) },
					{ name: "Failed IDs", value: ids.length ? ids.join(", ") : "none" },
				],
				footer: { text: "ProxyMaze Monitor" },
			},
		],
	};
}

function buildPayload(
	wh: WebhookRow,
	alert: AlertRow,
	event: "alert.fired" | "alert.resolved",
): object {
	if (wh.type === "slack") {
		const username = wh.username ?? "ProxyWatch";
		return event === "alert.fired"
			? slackFired(alert, username)
			: slackResolved(alert, username);
	}
	if (wh.type === "discord") {
		return event === "alert.fired" ? discordFired(alert) : discordResolved(alert);
	}
	return event === "alert.fired" ? standardFired(alert) : standardResolved(alert);
}

function shouldDeliver(
	wh: WebhookRow,
	event: "alert.fired" | "alert.resolved",
): boolean {
	if (!wh.events) return true;
	try {
		const allowed = JSON.parse(wh.events);
		if (!Array.isArray(allowed)) return true;
		return allowed.includes(event);
	} catch {
		return true;
	}
}

async function dispatchToAll(
	alert: AlertRow,
	event: "alert.fired" | "alert.resolved",
): Promise<void> {
	const allWebhooks = await db.select().from(webhooks);
	const now = new Date().toISOString();

	for (const wh of allWebhooks) {
		if (!shouldDeliver(wh, event)) continue;

		const payload = buildPayload(wh, alert, event);
		const body = JSON.stringify(payload);

		try {
			await db.insert(webhookDeliveries).values({
				webhookId: wh.webhookId,
				alertId: alert.alertId,
				event,
				status: "pending",
				payload: body,
				url: wh.url,
				attempts: 0,
				createdAt: now,
			});
		} catch {
			// UNIQUE(webhook_id, alert_id, event) collided: another worker has
			// already claimed this delivery. Treat as exactly-once and skip.
			continue;
		}

		const [row] = await db
			.select()
			.from(webhookDeliveries)
			.where(
				and(
					eq(webhookDeliveries.webhookId, wh.webhookId),
					eq(webhookDeliveries.alertId, alert.alertId),
					eq(webhookDeliveries.event, event),
				),
			)
			.limit(1);

		if (row && row.status === "pending") spawnDelivery(row);
	}
}

// Serialize the *enqueueing* of deliveries so the rows for a state transition
// are inserted in the same order eval observed them. Combined with per-webhook
// FIFO above, this gives ordered observation at every receiver.
let dispatchChain: Promise<void> = Promise.resolve();

function enqueueDispatch(
	alert: AlertRow,
	event: "alert.fired" | "alert.resolved",
): void {
	dispatchChain = dispatchChain
		.catch(() => undefined)
		.then(() => dispatchToAll(alert, event))
		.catch((err) => console.error(`[delivery] ${event} error:`, err));
}

export function dispatchAlertFired(alert: AlertRow): void {
	enqueueDispatch(alert, "alert.fired");
}

export function dispatchAlertResolved(alert: AlertRow): void {
	enqueueDispatch(alert, "alert.resolved");
}
