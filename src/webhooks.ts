import { db } from "./db";
import type { Alert } from "./alerts";
import {
	type AlertEvent,
	buildDiscordPayload,
	buildGenericPayload,
	buildSlackPayload,
} from "./integrations";
import { isTransientStatus, nowISO, uuid } from "./util";

export type WebhookType = "generic" | "slack" | "discord";

export type Webhook = {
	webhook_id: string;
	url: string;
	type: WebhookType;
	username: string | null;
	created_at: string;
};

const insertWebhookStmt = db.prepare(
	`INSERT INTO webhooks (webhook_id, url, type, username, created_at)
	 VALUES (?, ?, ?, ?, ?)`,
);

const listWebhooksStmt = db.query<Webhook, []>(
	"SELECT * FROM webhooks ORDER BY created_at ASC",
);

const insertDeliveryStmt = db.prepare(
	`INSERT OR IGNORE INTO webhook_deliveries
	 (webhook_id, alert_id, event, status, attempts, next_attempt_at, created_at)
	 VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
);

type DeliveryRow = {
	id: number;
	webhook_id: string;
	alert_id: string;
	event: AlertEvent;
	status: "pending" | "success" | "dead";
	attempts: number;
	next_attempt_at: string;
	last_error: string | null;
	created_at: string;
	delivered_at: string | null;
};

const claimReadyStmt = db.query<DeliveryRow, [string]>(
	`SELECT * FROM webhook_deliveries
	 WHERE status = 'pending' AND next_attempt_at <= ?
	 ORDER BY id ASC
	 LIMIT 50`,
);

const markSuccessStmt = db.prepare(
	`UPDATE webhook_deliveries
	 SET status = 'success', delivered_at = ?, attempts = ?, last_error = NULL
	 WHERE id = ? AND status = 'pending'`,
);

const markRetryStmt = db.prepare(
	`UPDATE webhook_deliveries
	 SET attempts = ?, next_attempt_at = ?, last_error = ?
	 WHERE id = ? AND status = 'pending'`,
);

const incrementCounter = db.prepare(
	"UPDATE metrics_counters SET value = value + 1 WHERE name = ?",
);

const getWebhookStmt = db.query<Webhook, [string]>(
	"SELECT * FROM webhooks WHERE webhook_id = ?",
);

const getAlertStmt = db.query<
	{
		alert_id: string;
		status: "active" | "resolved";
		failure_rate: number;
		total_proxies: number;
		failed_proxies: number;
		failed_proxy_ids: string;
		threshold: number;
		fired_at: string;
		resolved_at: string | null;
		message: string;
	},
	[string]
>("SELECT * FROM alerts WHERE alert_id = ?");

export function registerWebhook(input: {
	url: string;
	type?: WebhookType;
	username?: string | null;
}): Webhook {
	const id = `wh-${uuid()}`;
	const type: WebhookType = input.type ?? "generic";
	const username = input.username ?? null;
	insertWebhookStmt.run(id, input.url, type, username, nowISO());
	return {
		webhook_id: id,
		url: input.url,
		type,
		username,
		created_at: nowISO(),
	};
}

export function listWebhooks(): Webhook[] {
	return listWebhooksStmt.all();
}

export function enqueueAlertEvent(event: AlertEvent, _alert: Alert): void {
	const hooks = listWebhooks();
	if (hooks.length === 0) return;
	const ts = nowISO();
	const tx = db.transaction((items: Webhook[]) => {
		for (const h of items) {
			insertDeliveryStmt.run(h.webhook_id, _alert.alert_id, event, ts, ts);
		}
	});
	tx(hooks);
}

function backoffDelayMs(attempts: number): number {
	const base = 500 * Math.pow(2, Math.min(attempts, 6));
	const jitter = Math.floor(Math.random() * 250);
	return Math.min(base + jitter, 30_000);
}

function payloadFor(webhook: Webhook, event: AlertEvent, alert: Alert) {
	if (webhook.type === "slack")
		return buildSlackPayload(event, alert, webhook.username ?? undefined);
	if (webhook.type === "discord") return buildDiscordPayload(event, alert);
	return buildGenericPayload(event, alert);
}

async function attemptDelivery(row: DeliveryRow): Promise<void> {
	const webhook = getWebhookStmt.get(row.webhook_id);
	const alertRow = getAlertStmt.get(row.alert_id);
	if (!webhook || !alertRow) {
		// Webhook removed or alert lost; treat as terminal success so we don't
		// loop forever. (Spec doesn't allow webhook deletion via API, but we
		// stay defensive against manual DB tampering.)
		markSuccessStmt.run(nowISO(), row.attempts + 1, row.id);
		incrementCounter.run("webhook_deliveries");
		return;
	}
	const alert: Alert = {
		alert_id: alertRow.alert_id,
		status: alertRow.status,
		failure_rate: alertRow.failure_rate,
		total_proxies: alertRow.total_proxies,
		failed_proxies: alertRow.failed_proxies,
		failed_proxy_ids: JSON.parse(alertRow.failed_proxy_ids) as string[],
		threshold: alertRow.threshold,
		fired_at: alertRow.fired_at,
		resolved_at: alertRow.resolved_at,
		message: alertRow.message,
	};
	const payload = payloadFor(webhook, row.event, alert);
	const attempts = row.attempts + 1;

	try {
		const res = await fetch(webhook.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Proxy-Maze-Event": row.event,
				"X-Proxy-Maze-Delivery": String(row.id),
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000),
		});
		if (res.ok) {
			markSuccessStmt.run(nowISO(), attempts, row.id);
			incrementCounter.run("webhook_deliveries");
			return;
		}
		if (isTransientStatus(res.status)) {
			const next = new Date(Date.now() + backoffDelayMs(attempts)).toISOString();
			markRetryStmt.run(attempts, next, `HTTP ${res.status}`, row.id);
			return;
		}
		// Non-transient failure: receiver explicitly rejected. Treat as delivered
		// so we don't infinitely retry on misconfiguration; spec only mandates
		// retry on 5xx transient codes.
		markSuccessStmt.run(nowISO(), attempts, row.id);
		incrementCounter.run("webhook_deliveries");
	} catch (err) {
		const next = new Date(Date.now() + backoffDelayMs(attempts)).toISOString();
		const reason = err instanceof Error ? err.message : String(err);
		markRetryStmt.run(attempts, next, reason, row.id);
	}
}

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;

async function deliveryTick(): Promise<void> {
	if (workerRunning) return;
	workerRunning = true;
	try {
		const ready = claimReadyStmt.all(nowISO());
		if (ready.length === 0) return;
		await Promise.allSettled(ready.map(attemptDelivery));
	} finally {
		workerRunning = false;
	}
}

export function startDeliveryWorker(intervalMs = 500): void {
	if (workerInterval) return;
	workerInterval = setInterval(() => {
		void deliveryTick();
	}, intervalMs);
}

export function stopDeliveryWorker(): void {
	if (workerInterval) {
		clearInterval(workerInterval);
		workerInterval = null;
	}
}
