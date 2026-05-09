import { db } from "./db";
import { FAILURE_THRESHOLD, nowISO, round4, uuid } from "./util";
import { enqueueAlertEvent } from "./webhooks";

export type Alert = {
	alert_id: string;
	status: "active" | "resolved";
	failure_rate: number;
	total_proxies: number;
	failed_proxies: number;
	failed_proxy_ids: string[];
	threshold: number;
	fired_at: string;
	resolved_at: string | null;
	message: string;
};

type AlertRow = {
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
};

const selectActiveStmt = db.query<AlertRow, []>(
	"SELECT * FROM alerts WHERE status = 'active' LIMIT 1",
);

const selectAllStmt = db.query<AlertRow, []>(
	"SELECT * FROM alerts ORDER BY fired_at DESC",
);

const selectByIdStmt = db.query<AlertRow, [string]>(
	"SELECT * FROM alerts WHERE alert_id = ?",
);

const insertAlertStmt = db.prepare(
	`INSERT INTO alerts
	 (alert_id, status, failure_rate, total_proxies, failed_proxies,
	  failed_proxy_ids, threshold, fired_at, resolved_at, message)
	 VALUES (?, 'active', ?, ?, ?, ?, ?, ?, NULL, ?)`,
);

const resolveAlertStmt = db.prepare(
	`UPDATE alerts
	 SET status = 'resolved', resolved_at = ?, failure_rate = ?,
	     total_proxies = ?, failed_proxies = ?, failed_proxy_ids = ?, message = ?
	 WHERE alert_id = ? AND status = 'active'`,
);

const incrementCounter = db.prepare(
	"UPDATE metrics_counters SET value = value + 1 WHERE name = ?",
);

function rowToAlert(row: AlertRow): Alert {
	return {
		alert_id: row.alert_id,
		status: row.status,
		failure_rate: row.failure_rate,
		total_proxies: row.total_proxies,
		failed_proxies: row.failed_proxies,
		failed_proxy_ids: JSON.parse(row.failed_proxy_ids) as string[],
		threshold: row.threshold,
		fired_at: row.fired_at,
		resolved_at: row.resolved_at,
		message: row.message,
	};
}

export function getActiveAlert(): Alert | null {
	const row = selectActiveStmt.get();
	return row ? rowToAlert(row) : null;
}

export function listAlerts(): Alert[] {
	return selectAllStmt.all().map(rowToAlert);
}

export function getAlertById(id: string): Alert | null {
	const row = selectByIdStmt.get(id);
	return row ? rowToAlert(row) : null;
}

/**
 * Pool snapshot used by the alert engine after a sweep.
 */
export type PoolSnapshot = {
	total: number;
	down: number;
	failed_ids: string[];
	failure_rate: number;
};

export function buildSnapshotFromCounts(
	total: number,
	failedIds: string[],
): PoolSnapshot {
	const down = failedIds.length;
	const failure_rate = total === 0 ? 0 : down / total;
	return { total, down, failed_ids: failedIds, failure_rate };
}

/**
 * Evaluate a pool snapshot against the singleton-active-alert invariant.
 *
 *   - Breach (rate >= 0.20) and no active alert    -> mint new alert + fire event.
 *   - Breach and active alert exists               -> noop (alert id stays stable).
 *   - Recovery (rate < 0.20) and active alert      -> resolve + emit event.
 *   - No breach and no active                      -> noop.
 *
 * The empty pool (total === 0) cannot breach — failure rate is defined as 0.
 */
export function evaluateAlerts(snapshot: PoolSnapshot): void {
	const breach = snapshot.total > 0 && snapshot.failure_rate >= FAILURE_THRESHOLD;
	const active = getActiveAlert();
	const ts = nowISO();
	const failedIdsJson = JSON.stringify(snapshot.failed_ids);
	const rate = round4(snapshot.failure_rate);

	if (breach && !active) {
		const alertId = `alert-${uuid()}`;
		const message = `Failure rate ${(rate * 100).toFixed(2)}% exceeds threshold ${(FAILURE_THRESHOLD * 100).toFixed(0)}%`;
		insertAlertStmt.run(
			alertId,
			rate,
			snapshot.total,
			snapshot.down,
			failedIdsJson,
			FAILURE_THRESHOLD,
			ts,
			message,
		);
		incrementCounter.run("total_alerts");
		const fired = getAlertById(alertId);
		if (fired) enqueueAlertEvent("alert.fired", fired);
		return;
	}

	if (!breach && active) {
		const message = `Failure rate ${(rate * 100).toFixed(2)}% recovered below threshold ${(FAILURE_THRESHOLD * 100).toFixed(0)}%`;
		resolveAlertStmt.run(
			ts,
			rate,
			snapshot.total,
			snapshot.down,
			failedIdsJson,
			message,
			active.alert_id,
		);
		const resolved = getAlertById(active.alert_id);
		if (resolved) enqueueAlertEvent("alert.resolved", resolved);
	}
}
