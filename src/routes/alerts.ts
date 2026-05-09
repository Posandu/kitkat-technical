import { Elysia } from "elysia";
import { getActiveAlert, listAlerts } from "../alerts";

function serializeAlert(a: ReturnType<typeof getActiveAlert>) {
	if (!a) return null;
	return {
		alert_id: a.alert_id,
		status: a.status,
		failure_rate: a.failure_rate,
		threshold: a.threshold,
		total_proxies: a.total_proxies,
		failed_proxies: a.failed_proxies,
		failed_proxy_ids: a.failed_proxy_ids,
		fired_at: a.fired_at,
		resolved_at: a.resolved_at,
		message: a.message,
	};
}

export const alertsRoutes = new Elysia()
	.get("/alerts", () => {
		const all = listAlerts();
		const active = all.find((a) => a.status === "active") ?? null;
		return {
			active: serializeAlert(active),
			total: all.length,
			alerts: all.map(serializeAlert),
		};
	})
	.get("/alerts/active", ({ set }) => {
		const a = getActiveAlert();
		if (!a) {
			set.status = 404;
			return { error: "no_active_alert" };
		}
		return serializeAlert(a);
	});
