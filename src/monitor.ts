import { eq } from "drizzle-orm";
import { db } from "./db";
import { proxies as proxiesTable, proxyHistory } from "./db/schema";
import { getConfig } from "./routes/config";

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
}
