import { Elysia } from "elysia";
import swagger from "@elysiajs/swagger";
import "./db";
import "./state";
import { alertsRoutes } from "./routes/alerts";
import { configRoutes } from "./routes/config";
import { metricsRoutes } from "./routes/metrics";
import { proxiesRoutes } from "./routes/proxies";
import { webhooksRoutes } from "./routes/webhooks";
import { startMonitor } from "./monitor";
import { startDeliveryWorker } from "./webhooks";

startMonitor();
startDeliveryWorker();

const app = new Elysia()
	.onError(({ code, error, set }) => {
		if (code === "PARSE" || code === "VALIDATION") {
			set.status = 400;
			return {
				error: "invalid_request",
				message: error instanceof Error ? error.message : "malformed request",
			};
		}
		if (code === "NOT_FOUND") {
			set.status = 404;
			return { error: "not_found" };
		}
		set.status = 500;
		return {
			error: "internal_error",
			message: error instanceof Error ? error.message : "unknown error",
		};
	})
	.use(swagger({ path: "/swagger" }))
	.get("/", () => ({ name: "Proxy Maze 26", status: "watching" }))
	.get("/health", () => ({ status: "ok" }))
	.use(configRoutes)
	.use(proxiesRoutes)
	.use(alertsRoutes)
	.use(webhooksRoutes)
	.use(metricsRoutes)
	.listen(6969);

console.log(
	`Proxy Maze 26 listening at http://${app.server?.hostname}:${app.server?.port}`,
);
