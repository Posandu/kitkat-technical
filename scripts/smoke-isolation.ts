// Edge case: one receiver is permanently down (always 503), another receiver
// is healthy. Verify the healthy one isn't blocked by the dead one.

const BASE = "http://localhost:6969";

let deadCalls = 0;
const liveHits: { at: number; body: string }[] = [];

const receiver = Bun.serve({
	port: 7071,
	async fetch(req) {
		const url = new URL(req.url);
		const body = await req.text();
		if (url.pathname === "/dead") {
			deadCalls++;
			return new Response("nope", { status: 503 });
		}
		if (url.pathname === "/live") {
			liveHits.push({ at: Date.now(), body });
			return new Response("", { status: 200 });
		}
		return new Response("nf", { status: 404 });
	},
});

async function api(method: string, path: string, body?: unknown) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	try {
		return { status: res.status, body: JSON.parse(text) };
	} catch {
		return { status: res.status, body: text };
	}
}

async function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

async function main() {
	await api("POST", "/config", {
		check_interval_seconds: 1,
		request_timeout_ms: 500,
	});
	await api("POST", "/proxies", { proxies: [], replace: true });

	await api("POST", "/webhooks", { url: "http://localhost:7071/dead" });
	await api("POST", "/webhooks", { url: "http://localhost:7071/live" });

	const proxies = Array.from(
		{ length: 5 },
		(_, i) => `http://127.0.0.1:1/proxy/iso-${i + 1}`,
	);
	await api("POST", "/proxies", { proxies, replace: true });

	console.log("waiting 3s for fire + first deliveries");
	await sleep(3000);

	console.log("dead receiver attempts so far:", deadCalls);
	console.log("live receiver hits so far:", liveHits.length);
	console.log("(live should be >=1 even though dead is still retrying)");

	console.log("\nrecover the pool");
	await api("POST", "/proxies", {
		proxies: ["http://example.com/p/iso-1"],
		replace: true,
	});

	await sleep(3000);
	console.log("dead receiver attempts after recover:", deadCalls);
	console.log("live receiver hits after recover:", liveHits.length);

	receiver.stop();
}

main().catch((err) => {
	console.error(err);
	receiver.stop();
	process.exit(1);
});
