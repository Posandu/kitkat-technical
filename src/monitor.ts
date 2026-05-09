import { buildSnapshotFromCounts, evaluateAlerts } from "./alerts";
import {
	type ProbeResult,
	listProxies,
	recordProbeResult,
	summarizePool,
} from "./proxies";
import { getConfig } from "./state";

let running = false;
let stopped = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;

async function probeOne(
	id: string,
	url: string,
	timeoutMs: number,
): Promise<ProbeResult> {
	const started = performance.now();
	try {
		const res = await fetch(url, {
			method: "GET",
			signal: AbortSignal.timeout(timeoutMs),
			redirect: "manual",
		});
		const latency = Math.round(performance.now() - started);
		const status = res.status;
		// Drain body so the connection can be reused / released.
		try {
			await res.arrayBuffer();
		} catch {
			// ignore body read errors; status is what matters
		}
		const isUp = status >= 200 && status < 300;
		return {
			id,
			status: isUp ? "up" : "down",
			http_status: status,
			latency_ms: latency,
			error: isUp ? null : `non_2xx_${status}`,
		};
	} catch (err) {
		const latency = Math.round(performance.now() - started);
		const reason = err instanceof Error ? err.name : "error";
		const message = err instanceof Error ? err.message : String(err);
		return {
			id,
			status: "down",
			http_status: null,
			latency_ms: latency,
			error: `${reason}: ${message}`.slice(0, 500),
		};
	}
}

async function runSweep(): Promise<void> {
	const targets = listProxies();
	if (targets.length === 0) {
		// Still evaluate alerts so we resolve any active alert when the pool is empty.
		evaluateAlerts(buildSnapshotFromCounts(0, []));
		return;
	}
	const cfg = getConfig();
	const timeoutMs = Math.max(1, cfg.request_timeout_ms);
	const results = await Promise.all(
		targets.map((t) => probeOne(t.id, t.url, timeoutMs)),
	);
	for (const r of results) recordProbeResult(r);
	const summary = summarizePool();
	evaluateAlerts(
		buildSnapshotFromCounts(summary.total, summary.failed_ids),
	);
}

function scheduleNext(): void {
	if (stopped) return;
	const cfg = getConfig();
	const delayMs = Math.max(1000, cfg.check_interval_seconds * 1000);
	pendingTimer = setTimeout(() => {
		void tick();
	}, delayMs);
}

async function tick(): Promise<void> {
	if (stopped || running) return;
	running = true;
	inflight = runSweep().catch((err) => {
		console.error("[monitor] sweep failed:", err);
	});
	try {
		await inflight;
	} finally {
		inflight = null;
		running = false;
		scheduleNext();
	}
}

export function startMonitor(): void {
	if (pendingTimer || running) return;
	stopped = false;
	// Run the first sweep promptly so newly-added proxies don't sit in `pending`
	// for an entire interval before producing data.
	pendingTimer = setTimeout(() => {
		void tick();
	}, 50);
}

export function stopMonitor(): void {
	stopped = true;
	if (pendingTimer) {
		clearTimeout(pendingTimer);
		pendingTimer = null;
	}
}

/** Force an immediate sweep. Exposed for testability; not wired to any route. */
export async function runOneSweepNow(): Promise<void> {
	if (running && inflight) {
		await inflight;
		return;
	}
	await tick();
}
