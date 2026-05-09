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
import { resumePendingDeliveries } from "./delivery";

await loadConfig();
await resumePendingDeliveries();

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
	.listen(6969);

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
