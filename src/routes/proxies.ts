import { Elysia } from "elysia";
import {
	addProxies,
	getProxy,
	getProxyHistory,
	summarizePool,
	uptimePercentage,
} from "../proxies";

function serializeProxy(p: ReturnType<typeof getProxy>) {
	if (!p) return null;
	return {
		id: p.id,
		url: p.url,
		status: p.status,
		last_checked_at: p.last_checked_at,
		consecutive_failures: p.consecutive_failures,
	};
}

export const proxiesRoutes = new Elysia()
	.post("/proxies", ({ body, set }) => {
		if (!body || typeof body !== "object") {
			set.status = 400;
			return { error: "invalid_body", message: "expected JSON object" };
		}
		const b = body as Record<string, unknown>;
		const replace = b.replace === true;
		const raw = b.proxies;
		if (!Array.isArray(raw)) {
			set.status = 400;
			return {
				error: "invalid_proxies",
				message: "`proxies` must be an array of URLs or objects with a `url` field",
			};
		}
		const result = addProxies({
			proxies: raw as Array<string | { url: string }>,
			replace,
		});
		return {
			added: result.added.map(serializeProxy),
			skipped: result.skipped,
			cleared: result.cleared,
			pool_size: summarizePool().total,
		};
	})
	.get("/proxies", () => {
		const summary = summarizePool();
		return {
			total: summary.total,
			up: summary.up,
			down: summary.down,
			pending: summary.pending,
			failure_rate: summary.failure_rate,
			proxies: summary.proxies.map(serializeProxy),
		};
	})
	.get("/proxies/:id", ({ params, set }) => {
		const proxy = getProxy(params.id);
		if (!proxy) {
			set.status = 404;
			return { error: "not_found", message: `unknown proxy ${params.id}` };
		}
		return {
			id: proxy.id,
			url: proxy.url,
			status: proxy.status,
			last_checked_at: proxy.last_checked_at,
			consecutive_failures: proxy.consecutive_failures,
			total_checks: proxy.total_checks,
			successful_checks: proxy.successful_checks,
			uptime_percentage: uptimePercentage(proxy),
		};
	})
	.get("/proxies/:id/history", ({ params, set }) => {
		const history = getProxyHistory(params.id);
		if (history === null) {
			set.status = 404;
			return { error: "not_found", message: `unknown proxy ${params.id}` };
		}
		return history;
	});
