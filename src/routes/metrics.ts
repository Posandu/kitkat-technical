import Elysia from "elysia";
import { eq, count } from "drizzle-orm";
import { db } from "../db";
import { proxies as proxiesTable, proxyHistory, alerts as alertsTable, webhookDeliveries } from "../db/schema";

export const metricsRoutes = new Elysia({ prefix: "/metrics" }).get(
	"/",
	async () => {
		const [
			[{ total_checks }],
			[{ current_pool_size }],
			[{ active_alerts }],
			[{ total_alerts }],
			[{ webhook_deliveries: wd }],
		] = await Promise.all([
			db.select({ total_checks: count() }).from(proxyHistory),
			db.select({ current_pool_size: count() }).from(proxiesTable),
			db.select({ active_alerts: count() }).from(alertsTable).where(eq(alertsTable.status, "active")),
			db.select({ total_alerts: count() }).from(alertsTable),
			db
				.select({ webhook_deliveries: count() })
				.from(webhookDeliveries)
				.where(eq(webhookDeliveries.status, "delivered")),
		]);

		return {
			total_checks,
			current_pool_size,
			active_alerts,
			total_alerts,
			webhook_deliveries: wd,
		};
	},
);
