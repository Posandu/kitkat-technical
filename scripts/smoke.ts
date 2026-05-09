// Quick smoke test: spins up a webhook receiver that fails 3x with 503 then
// 200, registers it, registers Slack and Discord integrations, posts proxies
// pointing at unreachable URLs, and prints what each endpoint received.

const BASE = "http://localhost:6969";

type Hit = {
	at: number;
	method: string;
	path: string;
	status: number;
	body: string;
};
const hits: Hit[] = [];

let standardCalls = 0;
const slackHits: Hit[] = [];
const discordHits: Hit[] = [];

const receiver = Bun.serve({
	port: 7070,
	async fetch(req) {
		const url = new URL(req.url);
		const body = await req.text();
		const at = Date.now();

		if (url.pathname === "/webhook") {
			standardCalls++;
			const status = standardCalls <= 3 ? 503 : 200;
			hits.push({ at, method: req.method, path: url.pathname, status, body });
			return new Response("", { status });
		}
		if (url.pathname === "/slack") {
			slackHits.push({ at, method: req.method, path: url.pathname, status: 200, body });
			return new Response("", { status: 200 });
		}
		if (url.pathname === "/discord") {
			discordHits.push({ at, method: req.method, path: url.pathname, status: 200, body });
			return new Response("", { status: 200 });
		}
		return new Response("not found", { status: 404 });
	},
});

console.log(`receiver listening on ${receiver.port}`);

async function api(method: string, path: string, body?: unknown) {
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
	return { status: res.status, body: parsed };
}

async function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

async function main() {
	console.log("\n[1] tighten cadence");
	console.log(
		await api("POST", "/config", {
			check_interval_seconds: 1,
			request_timeout_ms: 500,
		}),
	);

	console.log("\n[2] register webhook (will return 503x3 then 200)");
	console.log(
		await api("POST", "/webhooks", {
			url: "http://localhost:7070/webhook",
		}),
	);

	console.log("\n[3] register Slack integration");
	console.log(
		await api("POST", "/integrations", {
			type: "slack",
			webhook_url: "http://localhost:7070/slack",
			username: "ProxyMaze",
			events: ["alert.fired", "alert.resolved"],
		}),
	);

	console.log("\n[4] register Discord integration");
	console.log(
		await api("POST", "/integrations", {
			type: "discord",
			webhook_url: "http://localhost:7070/discord",
			username: "ProxyMaze",
			events: ["alert.fired", "alert.resolved"],
		}),
	);

	console.log("\n[5] post 10 unreachable proxies (replace=true)");
	const proxies = Array.from({ length: 10 }, (_, i) => `http://127.0.0.1:1/proxy/px-${i + 1}`);
	console.log(await api("POST", "/proxies", { proxies, replace: true }));

	console.log("\n[6] wait 4s for probes + alert fire + retries");
	await sleep(4000);

	console.log("\n[7] state check");
	console.log("GET /proxies:", await api("GET", "/proxies"));
	console.log("GET /alerts:", await api("GET", "/alerts"));
	console.log("GET /metrics:", await api("GET", "/metrics"));

	console.log("\n[8] standard receiver hits:");
	for (const h of hits) {
		const t = ((h.at - hits[0].at) / 1000).toFixed(2);
		console.log(`  +${t}s -> ${h.status} body[0..120]=${h.body.slice(0, 120)}`);
	}

	console.log("\n[9] slack receiver hits:");
	for (const h of slackHits) {
		console.log(`  body=${h.body.slice(0, 400)}`);
	}

	console.log("\n[10] discord receiver hits:");
	for (const h of discordHits) {
		console.log(`  body=${h.body.slice(0, 400)}`);
	}

	console.log("\n[11] now make proxies recover (replace with example.com)");
	const goodProxies = Array.from(
		{ length: 10 },
		(_, i) => `http://example.com/proxy/px-good-${i + 1}`,
	);
	console.log(await api("POST", "/proxies", { proxies: goodProxies, replace: true }));

	await sleep(5000);

	console.log("\n[12] state after recovery");
	console.log("GET /alerts:", await api("GET", "/alerts"));
	console.log("GET /metrics:", await api("GET", "/metrics"));

	console.log("\n[13] receiver hits (after recovery):");
	console.log("standard total:", hits.length);
	console.log("slack total:", slackHits.length);
	console.log("discord total:", discordHits.length);

	receiver.stop();
}

main().catch((err) => {
	console.error(err);
	receiver.stop();
	process.exit(1);
});
