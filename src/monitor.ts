import { eq } from "drizzle-orm";
import { db } from "./db";
import { proxies as proxiesTable, proxyHistory, alerts as alertsTable } from "./db/schema";
import { getConfig } from "./routes/config";

const THRESHOLD = 0.2;

function newAlertId(): string {
	return `alert-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function probeProxy(
	url: string,
	timeoutMs: number,
): Promise<"up" | "down"> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(url, { signal: controller.signal });
		return res.ok || (res.status >= 200 && res.status < 300) ? "up" : "down";
	} catch {
		return "down";
	} finally {
		clearTimeout(timer);
	}
}

export async function runChecks(): Promise<void> {
	const { requestTimeoutMs } = getConfig();
	const rows = await db.select().from(proxiesTable);

	if (rows.length === 0) return;

	const checkedAt = new Date().toISOString();

	const results = await Promise.all(
		rows.map(async (proxy) => {
			const status = await probeProxy(proxy.url, requestTimeoutMs);
			return { proxy, status };
		}),
	);

	await Promise.all(
		results.map(async ({ proxy, status }) => {
			const consecutiveFailures =
				status === "down" ? proxy.consecutiveFailures + 1 : 0;

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

	await evaluateAlerts(checkedAt);
}

async function evaluateAlerts(now: string): Promise<void> {
	const allProxies = await db.select().from(proxiesTable);
	const total = allProxies.length;
	if (total === 0) return;

	const downProxies = allProxies.filter((p) => p.status === "down");
	const failureRate = downProxies.length / total;

	const [activeAlert] = await db
		.select()
		.from(alertsTable)
		.where(eq(alertsTable.status, "active"))
		.limit(1);

	if (failureRate >= THRESHOLD && !activeAlert) {
		await db.insert(alertsTable).values({
			alertId: newAlertId(),
			status: "active",
			failureRate,
			totalProxies: total,
			failedProxies: downProxies.length,
			failedProxyIds: JSON.stringify(downProxies.map((p) => p.id)),
			threshold: THRESHOLD,
			firedAt: now,
			message: "Proxy pool failure rate exceeded threshold",
		});
	} else if (failureRate < THRESHOLD && activeAlert) {
		await db
			.update(alertsTable)
			.set({ status: "resolved", resolvedAt: now })
			.where(eq(alertsTable.alertId, activeAlert.alertId));
	}
}
