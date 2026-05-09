/**
 * End-to-end smoke test.
 *
 * Spins up two local "fake target" servers (one healthy, one always-503), plus
 * a webhook receiver that fails the first three deliveries with 503 then 200,
 * and a Slack/Discord receiver. Then drives the Proxy Maze HTTP API through a
 * full breach -> recover -> re-breach lifecycle and prints assertions.
 */

const BASE = "http://localhost:6969";

type Hit = {
	at: number;
	status: number;
	body: unknown;
};

let healthyHits = 0;
let downHits = 0;

let standardCalls = 0;
const standardHits: Hit[] = [];
const slackHits: Hit[] = [];
const discordHits: Hit[] = [];

const targetServer = Bun.serve({
	port: 7170,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname.startsWith("/proxy/healthy/")) {
			healthyHits++;
			return new Response("ok", { status: 200 });
		}
		if (url.pathname.startsWith("/proxy/down/")) {
			downHits++;
			return new Response("server error", { status: 503 });
		}
		return new Response("not found", { status: 404 });
	},
});

const receiverServer = Bun.serve({
	port: 7171,
	async fetch(req) {
		const url = new URL(req.url);
		const at = Date.now();
		const text = await req.text();
		let parsed: unknown = text;
		try {
			parsed = JSON.parse(text);
		} catch {}
		if (url.pathname === "/webhook") {
			standardCalls++;
			const status = standardCalls <= 3 ? 503 : 200;
			standardHits.push({ at, status, body: parsed });
			return new Response("", { status });
		}
		if (url.pathname === "/slack") {
			slackHits.push({ at, status: 200, body: parsed });
			return new Response("", { status: 200 });
		}
		if (url.pathname === "/discord") {
			discordHits.push({ at, status: 200, body: parsed });
			return new Response("", { status: 200 });
		}
		return new Response("not found", { status: 404 });
	},
});

console.log(`[smoke] target server on :${targetServer.port}`);
console.log(`[smoke] receiver server on :${receiverServer.port}`);

async function api<T = unknown>(
	method: string,
	path: string,
	body?: unknown,
): Promise<{ status: number; body: T }> {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let parsed: unknown = text;
	try {
		parsed = JSON.parse(text);
	} catch {}
	return { status: res.status, body: parsed as T };
}

function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

function header(label: string) {
	console.log(`\n=== ${label} ===`);
}

async function waitFor<T>(
	label: string,
	predicate: () => Promise<{ ok: boolean; value: T }>,
	timeoutMs = 30_000,
): Promise<T> {
	const start = Date.now();
	let last: T | undefined;
	while (Date.now() - start < timeoutMs) {
		const r = await predicate();
		last = r.value;
		if (r.ok) {
			console.log(`[smoke] ${label} ok in ${Date.now() - start}ms`);
			return r.value;
		}
		await sleep(250);
	}
	throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function main() {
	header("config: tighten cadence");
	const cfg1 = await api("POST", "/config", {
		check_interval_seconds: 1,
		request_timeout_ms: 1500,
		ignored_field: "should be permitted",
	});
	console.log("POST /config", cfg1.status, cfg1.body);

	const cfg2 = await api("GET", "/config");
	console.log("GET /config", cfg2.status, cfg2.body);

	header("webhooks: register generic + slack + discord");
	const wh1 = await api<{ webhook_id: string }>("POST", "/webhooks", {
		url: "http://localhost:7171/webhook",
	});
	console.log("POST /webhooks (generic)", wh1.status, wh1.body);

	const wh2 = await api<{ webhook_id: string }>("POST", "/webhooks", {
		url: "http://localhost:7171/slack",
		type: "slack",
		username: "Watchtower",
	});
	console.log("POST /webhooks (slack)", wh2.status, wh2.body);

	const wh3 = await api<{ webhook_id: string }>("POST", "/webhooks", {
		url: "http://localhost:7171/discord",
		type: "discord",
	});
	console.log("POST /webhooks (discord)", wh3.status, wh3.body);

	header("proxies: load 5 targets, 4 healthy + 1 down (rate 0.20)");
	const load1 = await api("POST", "/proxies", {
		replace: true,
		proxies: [
			"http://localhost:7170/proxy/healthy/px-1",
			"http://localhost:7170/proxy/healthy/px-2",
			"http://localhost:7170/proxy/healthy/px-3",
			"http://localhost:7170/proxy/healthy/px-4",
			"http://localhost:7170/proxy/down/px-99",
		],
	});
	console.log("POST /proxies", load1.status, load1.body);

	header("waiting for first sweep + breach detection");
	await waitFor("breach + at least one alert active", async () => {
		const list = await api<{ active: { alert_id: string } | null }>(
			"GET",
			"/alerts",
		);
		return { ok: list.body.active !== null, value: list.body };
	});

	const proxiesView = await api("GET", "/proxies");
	console.log("GET /proxies", proxiesView.status, proxiesView.body);

	header("waiting for generic webhook to be delivered (after 3x 503 retries)");
	await waitFor(
		"generic delivered post-retry",
		async () => ({ ok: standardCalls >= 4, value: { standardCalls } }),
		20_000,
	);
	console.log(`[smoke] generic calls so far: ${standardCalls}`);
	console.log(`[smoke] slack calls: ${slackHits.length}`);
	console.log(`[smoke] discord calls: ${discordHits.length}`);

	header("recovery: switch all to healthy");
	const load2 = await api("POST", "/proxies", {
		replace: true,
		proxies: [
			"http://localhost:7170/proxy/healthy/px-1",
			"http://localhost:7170/proxy/healthy/px-2",
			"http://localhost:7170/proxy/healthy/px-3",
		],
	});
	console.log("POST /proxies (replace)", load2.status, load2.body);

	await waitFor("alert resolved", async () => {
		const list = await api<{
			active: { alert_id: string } | null;
			alerts: Array<{ status: string }>;
		}>("GET", "/alerts");
		return { ok: list.body.active === null, value: list.body };
	});

	header("re-breach: introduce another all-down proxy");
	const load3 = await api("POST", "/proxies", {
		replace: true,
		proxies: [
			"http://localhost:7170/proxy/down/px-9001",
			"http://localhost:7170/proxy/healthy/px-1",
		],
	});
	console.log("POST /proxies (replace)", load3.status, load3.body);

	const newAlert = await waitFor<{ active: { alert_id: string } | null }>(
		"new alert minted with fresh id",
		async () => {
			const list = await api<{ active: { alert_id: string } | null }>(
				"GET",
				"/alerts",
			);
			return { ok: list.body.active !== null, value: list.body };
		},
	);

	header("metrics");
	const metrics = await api("GET", "/metrics");
	console.log("GET /metrics", metrics.status, metrics.body);

	header("history check");
	const hist = await api<unknown[]>("GET", "/proxies/px-1/history");
	console.log(
		`GET /proxies/px-1/history -> ${hist.status} entries=${(hist.body as unknown[]).length}`,
	);

	header("404 for unknown proxy");
	const unknown = await api("GET", "/proxies/does-not-exist");
	console.log("GET /proxies/does-not-exist", unknown.status, unknown.body);

	header("delivery summary");
	console.log(`standard webhook calls: ${standardCalls} (expect >= 4)`);
	console.log(`slack calls: ${slackHits.length}`);
	console.log(`discord calls: ${discordHits.length}`);
	if (slackHits[0]) {
		const first = slackHits[0].body as {
			username?: string;
			text?: string;
			attachments?: Array<{ color?: string; ts?: number }>;
		};
		console.log("slack sample:", {
			username: first.username,
			text: first.text,
			attachment_color: first.attachments?.[0]?.color,
			attachment_ts: first.attachments?.[0]?.ts,
		});
	}
	if (discordHits[0]) {
		const first = discordHits[0].body as {
			embeds?: Array<{ title?: string; color?: number }>;
		};
		console.log("discord sample:", {
			embed_title: first.embeds?.[0]?.title,
			embed_color: first.embeds?.[0]?.color,
		});
	}

	console.log(
		`final active alert id: ${newAlert.active?.alert_id ?? "<none>"}`,
	);

	console.log("\n[smoke] healthy hits:", healthyHits, "down hits:", downHits);
}

main()
	.catch((e) => {
		console.error("[smoke] FAILED", e);
		process.exitCode = 1;
	})
	.finally(() => {
		targetServer.stop(true);
		receiverServer.stop(true);
	});
