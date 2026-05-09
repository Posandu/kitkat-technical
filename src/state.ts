import { db } from "./db";
import { nowISO } from "./util";

export type RuntimeConfig = {
	check_interval_seconds: number;
	request_timeout_ms: number;
};

const DEFAULTS: RuntimeConfig = {
	check_interval_seconds: 15,
	request_timeout_ms: 3000,
};

let cached: RuntimeConfig = { ...DEFAULTS };

const selectStmt = db.query<
	{ check_interval_seconds: number; request_timeout_ms: number },
	[]
>(
	"SELECT check_interval_seconds, request_timeout_ms FROM config WHERE id = 1",
);

const upsertStmt = db.prepare(
	`INSERT INTO config (id, check_interval_seconds, request_timeout_ms, updated_at)
	 VALUES (1, ?, ?, ?)
	 ON CONFLICT(id) DO UPDATE SET
	   check_interval_seconds = excluded.check_interval_seconds,
	   request_timeout_ms = excluded.request_timeout_ms,
	   updated_at = excluded.updated_at`,
);

export function loadConfig(): RuntimeConfig {
	const row = selectStmt.get();
	if (row) {
		cached = {
			check_interval_seconds: row.check_interval_seconds,
			request_timeout_ms: row.request_timeout_ms,
		};
	} else {
		upsertStmt.run(
			DEFAULTS.check_interval_seconds,
			DEFAULTS.request_timeout_ms,
			nowISO(),
		);
		cached = { ...DEFAULTS };
	}
	return cached;
}

export function getConfig(): RuntimeConfig {
	return cached;
}

export function setConfig(next: RuntimeConfig): RuntimeConfig {
	upsertStmt.run(next.check_interval_seconds, next.request_timeout_ms, nowISO());
	cached = { ...next };
	return cached;
}

loadConfig();
