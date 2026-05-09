import { db } from "./db";
import { nowISO, proxyIdFromUrl, round4 } from "./util";

export type ProxyStatus = "pending" | "up" | "down";

export type Proxy = {
	id: string;
	url: string;
	status: ProxyStatus;
	last_checked_at: string | null;
	consecutive_failures: number;
	total_checks: number;
	successful_checks: number;
};

export type ProxyHistoryEntry = {
	proxy_id: string;
	status: Exclude<ProxyStatus, "pending">;
	http_status: number | null;
	latency_ms: number | null;
	error: string | null;
	checked_at: string;
};

const insertProxyStmt = db.prepare(
	`INSERT INTO proxies
	 (id, url, status, last_checked_at, consecutive_failures,
	  total_checks, successful_checks, created_at)
	 VALUES (?, ?, 'pending', NULL, 0, 0, 0, ?)
	 ON CONFLICT(id) DO UPDATE SET
	   url = excluded.url`,
);

const clearProxiesStmt = db.prepare("DELETE FROM proxies");
const clearHistoryStmt = db.prepare("DELETE FROM proxy_history");

const listProxiesStmt = db.query<Proxy, []>(
	`SELECT id, url, status, last_checked_at, consecutive_failures,
	        total_checks, successful_checks
	 FROM proxies
	 ORDER BY id ASC`,
);

const getProxyStmt = db.query<Proxy, [string]>(
	`SELECT id, url, status, last_checked_at, consecutive_failures,
	        total_checks, successful_checks
	 FROM proxies WHERE id = ?`,
);

const insertHistoryStmt = db.prepare(
	`INSERT INTO proxy_history
	 (proxy_id, status, http_status, latency_ms, error, checked_at)
	 VALUES (?, ?, ?, ?, ?, ?)`,
);

const listHistoryStmt = db.query<ProxyHistoryEntry, [string]>(
	`SELECT proxy_id, status, http_status, latency_ms, error, checked_at
	 FROM proxy_history
	 WHERE proxy_id = ?
	 ORDER BY id ASC`,
);

const updateProxyAfterCheckStmt = db.prepare(
	`UPDATE proxies
	 SET status = ?,
	     last_checked_at = ?,
	     consecutive_failures = CASE WHEN ? = 'up' THEN 0 ELSE consecutive_failures + 1 END,
	     total_checks = total_checks + 1,
	     successful_checks = successful_checks + CASE WHEN ? = 'up' THEN 1 ELSE 0 END
	 WHERE id = ?`,
);

const incrementCounter = db.prepare(
	"UPDATE metrics_counters SET value = value + 1 WHERE name = ?",
);

export type AddProxiesInput = {
	proxies: Array<string | { url: string }>;
	replace?: boolean;
};

export type AddProxiesResult = {
	added: Proxy[];
	skipped: Array<{ url: string; reason: string }>;
	cleared: boolean;
};

export function addProxies(input: AddProxiesInput): AddProxiesResult {
	const cleared = !!input.replace;
	const skipped: AddProxiesResult["skipped"] = [];
	const accepted: Array<{ id: string; url: string }> = [];
	const seen = new Set<string>();

	for (const entry of input.proxies) {
		const url = typeof entry === "string" ? entry : entry?.url;
		if (typeof url !== "string" || url.length === 0) {
			skipped.push({ url: String(url), reason: "missing_url" });
			continue;
		}
		const id = proxyIdFromUrl(url);
		if (!id) {
			skipped.push({ url, reason: "invalid_url" });
			continue;
		}
		if (seen.has(id)) {
			skipped.push({ url, reason: "duplicate_id_in_request" });
			continue;
		}
		seen.add(id);
		accepted.push({ id, url });
	}

	const tx = db.transaction(() => {
		if (cleared) {
			clearProxiesStmt.run();
			// Note: history is intentionally cleared with the pool because per-proxy
			// stats (uptime_percentage, total_checks) would otherwise reference IDs
			// that may belong to a brand-new URL. Alerts and webhook archives are
			// preserved (different tables).
			clearHistoryStmt.run();
		}
		const ts = nowISO();
		for (const p of accepted) {
			insertProxyStmt.run(p.id, p.url, ts);
		}
	});
	tx();

	const added = accepted
		.map((p) => getProxyStmt.get(p.id))
		.filter((p): p is Proxy => !!p);

	return { added, cleared, skipped };
}

export function listProxies(): Proxy[] {
	return listProxiesStmt.all();
}

export function getProxy(id: string): Proxy | null {
	return getProxyStmt.get(id);
}

export function getProxyHistory(id: string): ProxyHistoryEntry[] | null {
	const exists = getProxyStmt.get(id);
	if (!exists) return null;
	return listHistoryStmt.all(id);
}

export type ProbeResult = {
	id: string;
	status: "up" | "down";
	http_status: number | null;
	latency_ms: number;
	error: string | null;
};

/**
 * Persist a probe outcome: insert history row and update aggregate stats.
 * Called by the monitor after every probe. Wrapped in a transaction so the
 * history row and counters move atomically.
 */
export function recordProbeResult(result: ProbeResult): void {
	const ts = nowISO();
	const tx = db.transaction(() => {
		insertHistoryStmt.run(
			result.id,
			result.status,
			result.http_status,
			result.latency_ms,
			result.error,
			ts,
		);
		updateProxyAfterCheckStmt.run(
			result.status,
			ts,
			result.status,
			result.status,
			result.id,
		);
		incrementCounter.run("total_checks");
	});
	tx();
}

export type PoolSummary = {
	total: number;
	up: number;
	down: number;
	pending: number;
	failure_rate: number;
	failed_ids: string[];
	proxies: Proxy[];
};

export function summarizePool(): PoolSummary {
	const all = listProxies();
	let up = 0;
	let down = 0;
	let pending = 0;
	const failed_ids: string[] = [];
	for (const p of all) {
		if (p.status === "up") up++;
		else if (p.status === "down") {
			down++;
			failed_ids.push(p.id);
		} else pending++;
	}
	const total = all.length;
	const failure_rate = total === 0 ? 0 : down / total;
	return {
		total,
		up,
		down,
		pending,
		failure_rate: round4(failure_rate),
		failed_ids,
		proxies: all,
	};
}

export function uptimePercentage(p: Proxy): number {
	if (p.total_checks === 0) return 0;
	return round4(p.successful_checks / p.total_checks);
}
