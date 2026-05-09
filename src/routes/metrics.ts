import { Elysia } from "elysia";
import { db } from "../db";
import { listAlerts } from "../alerts";
import { summarizePool } from "../proxies";

const counterStmt = db.query<{ value: number }, [string]>(
	"SELECT value FROM metrics_counters WHERE name = ?",
);

const activeAlertsStmt = db.query<{ c: number }, []>(
	"SELECT COUNT(*) as c FROM alerts WHERE status = 'active'",
);

function counter(name: string): number {
	return counterStmt.get(name)?.value ?? 0;
}

export const metricsRoutes = new Elysia().get("/metrics", () => {
	const summary = summarizePool();
	const alerts = listAlerts();
	return {
		total_checks: counter("total_checks"),
		current_pool_size: summary.total,
		active_alerts: activeAlertsStmt.get()?.c ?? 0,
		total_alerts: alerts.length,
		webhook_deliveries: counter("webhook_deliveries"),
		pool: {
			up: summary.up,
			down: summary.down,
			pending: summary.pending,
			failure_rate: summary.failure_rate,
		},
	};
});
