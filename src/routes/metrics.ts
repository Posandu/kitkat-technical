import Elysia from "elysia";
import { eq, count } from "drizzle-orm";
import { db } from "../db";
import { proxies as proxiesTable, proxyHistory, alerts as alertsTable } from "../db/schema";

export const metricsRoutes = new Elysia({ prefix: "/metrics" }).get(
	"/",
	async () => {
		const [[{ total_checks }], [{ current_pool_size }], [{ active_alerts }], [{ total_alerts }]] =
			await Promise.all([
				db.select({ total_checks: count() }).from(proxyHistory),
				db.select({ current_pool_size: count() }).from(proxiesTable),
				db.select({ active_alerts: count() }).from(alertsTable).where(eq(alertsTable.status, "active")),
				db.select({ total_alerts: count() }).from(alertsTable),
			]);

		return {
			total_checks,
			current_pool_size,
			active_alerts,
			total_alerts,
			webhook_deliveries: 0,
		};
	},
);
