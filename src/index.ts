import { Elysia } from "elysia";
import { healthRoutes } from "./routes/health";
import { configRoutes, loadConfig } from "./routes/config";
import { proxiesRoutes } from "./routes/proxies";
import { alertsRoutes } from "./routes/alerts";
import { webhooksRoutes } from "./routes/webhooks";
import { integrationsRoutes } from "./routes/integrations";
import { metricsRoutes } from "./routes/metrics";
import swagger from "@elysiajs/swagger";
import { startMonitor } from "./scheduler";

await loadConfig();

startMonitor();

const app = new Elysia()
	.use(swagger())
	.get("/", () => "Hello world")
	.use(healthRoutes)
	.use(configRoutes)
	.use(proxiesRoutes)
	.use(alertsRoutes)
	.use(webhooksRoutes)
	.use(integrationsRoutes)
	.use(metricsRoutes)
	.listen({ port: 6969, hostname: "139.59.123.183" });

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
