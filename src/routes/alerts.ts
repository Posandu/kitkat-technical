import Elysia from "elysia";
import { db } from "../db";
import { alerts as alertsTable } from "../db/schema";

export const alertsRoutes = new Elysia({ prefix: "/alerts" }).get(
	"/",
	async () => {
		const rows = await db.select().from(alertsTable);

		return rows.map((r) => ({
			alert_id: r.alertId,
			status: r.status,
			failure_rate: r.failureRate,
			total_proxies: r.totalProxies,
			failed_proxies: r.failedProxies,
			failed_proxy_ids: JSON.parse(r.failedProxyIds),
			threshold: r.threshold,
			fired_at: r.firedAt,
			resolved_at: r.resolvedAt,
			message: r.message,
		}));
	},
);
