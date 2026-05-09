import { eq } from "drizzle-orm";
import { db } from "./db";
import { proxies as proxiesTable, proxyHistory, alerts as alertsTable } from "./db/schema";
import { getConfig } from "./routes/config";
import { dispatchAlertFired, dispatchAlertResolved } from "./delivery";

const THRESHOLD = 0.2;

function newAlertId(): string {
	return `alert-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function probeProxy(
	url: string,
	timeoutMs: number,
): Promise<"up" | "down" | "timeout" | "5xx"> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(url, { signal: controller.signal });
		if (res.status >= 200 && res.status < 300) {
			return "up";
		} else if (res.status >= 500) {
			return "5xx";
		} else {
			return "down";
		}
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError") {
			return "timeout";
		}
		return "down";
	} finally {
		clearTimeout(timer);
	}
}

export async function runChecks(): Promise<void> {
	const { requestTimeoutMs } = getConfig();
	const rows = await db.select().from(proxiesTable);
	const checkedAt = new Date().toISOString();

	if (rows.length > 0) {
		const results = await Promise.all(
			rows.map(async (proxy) => {
				const status = await probeProxy(proxy.url, requestTimeoutMs);
				return { proxy, status };
			}),
		);

		await Promise.all(
			results.map(async ({ proxy, status }) => {
const isDown = status !== "up";
			const consecutiveFailures = isDown ? proxy.consecutiveFailures + 1 : 0;

				await db
					.update(proxiesTable)
					.set({ status, lastCheckedAt: checkedAt, consecutiveFailures })
					.where(eq(proxiesTable.id, proxy.id));

				await db.insert(proxyHistory).values({
					proxyId: proxy.id,
					status,
					checkedAt,
				});
			}),
		);
	}

	await evaluateAlertState(checkedAt);
}

export async function evaluateAlertState(now?: string): Promise<void> {
	const ts = now ?? new Date().toISOString();
	const allProxies = await db.select().from(proxiesTable);
	const total = allProxies.length;

	const downProxies = allProxies.filter((p) => p.status !== "up");
	const failedIds = downProxies.map((p) => p.id);
	const failureRate = total > 0 ? downProxies.length / total : 0;

	const [activeAlert] = await db
		.select()
		.from(alertsTable)
		.where(eq(alertsTable.status, "active"))
		.limit(1);

	const breached = total > 0 && failureRate >= THRESHOLD;

	if (breached && !activeAlert) {
		const [inserted] = await db
			.insert(alertsTable)
			.values({
				alertId: newAlertId(),
				status: "active",
				failureRate,
				totalProxies: total,
				failedProxies: downProxies.length,
				failedProxyIds: JSON.stringify(failedIds),
				threshold: THRESHOLD,
				firedAt: ts,
				message: "Proxy pool failure rate exceeded threshold",
			})
			.returning();
		console.log(`[monitor] Alert fired: ${inserted.alertId} (rate=${(failureRate*100).toFixed(0)}%)`);
		await dispatchAlertFired(inserted);
	} else if (breached && activeAlert) {
		await db
			.update(alertsTable)
			.set({
				failureRate,
				totalProxies: total,
				failedProxies: downProxies.length,
				failedProxyIds: JSON.stringify(failedIds),
			})
			.where(eq(alertsTable.alertId, activeAlert.alertId));
	} else if (!breached && activeAlert) {
		const [updated] = await db
			.update(alertsTable)
			.set({
				status: "resolved",
				resolvedAt: ts,
				failureRate,
				totalProxies: total,
				failedProxies: downProxies.length,
				failedProxyIds: JSON.stringify(failedIds),
			})
			.where(eq(alertsTable.alertId, activeAlert.alertId))
			.returning();
		console.log(`[monitor] Alert resolved: ${activeAlert.alertId}`);
		await dispatchAlertResolved(updated);
	}
}
