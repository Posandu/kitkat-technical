import { Elysia } from "elysia";
import { getConfig, setConfig } from "../state";

export const configRoutes = new Elysia()
	.get("/config", () => getConfig())
	.post("/config", ({ body, set }) => {
		if (!body || typeof body !== "object") {
			set.status = 400;
			return { error: "invalid_body", message: "expected JSON object" };
		}
		const b = body as Record<string, unknown>;
		const interval = b.check_interval_seconds;
		const timeout = b.request_timeout_ms;
		if (typeof interval !== "number" || !Number.isFinite(interval) || interval < 1) {
			set.status = 400;
			return {
				error: "invalid_check_interval_seconds",
				message: "must be a positive integer (>= 1)",
			};
		}
		if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 1) {
			set.status = 400;
			return {
				error: "invalid_request_timeout_ms",
				message: "must be a positive integer (>= 1)",
			};
		}
		return setConfig({
			check_interval_seconds: Math.floor(interval),
			request_timeout_ms: Math.floor(timeout),
		});
	});
