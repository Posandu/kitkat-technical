import { Elysia } from "elysia";
import { healthRoutes } from "./routes/health";
import { configRoutes } from "./routes/config";
import { proxiesRoutes } from "./routes/proxies";
import { alertsRoutes } from "./routes/alerts";
import { webhooksRoutes } from "./routes/webhooks";
import { integrationsRoutes } from "./routes/integrations";
import { metricsRoutes } from "./routes/metrics";

const app = new Elysia()
	.use(healthRoutes)
	.use(configRoutes)
	.use(proxiesRoutes)
	.use(alertsRoutes)
	.use(webhooksRoutes)
	.use(integrationsRoutes)
	.use(metricsRoutes)
	.listen(3000);

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
