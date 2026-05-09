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
import { db } from "./db";
import { webhooks } from "./db/schema";
import { eq } from "drizzle-orm";

await loadConfig();

// Register Discord webhook
const discordWebhookUrl = "https://discord.com/api/webhooks/1502580067061071902/QdRIzAC0AOnuCYSAcGFWR1iV7U_BT-3Y66_05S5pKVBcxMkLP3rPE-OJNdUP6sb-RNGR";
const [existingDiscordWebhook] = await db
	.select()
	.from(webhooks)
	.where(eq(webhooks.type, "discord"))
	.limit(1);

if (!existingDiscordWebhook) {
	await db.insert(webhooks).values({
		webhookId: `wh-discord-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
		url: discordWebhookUrl,
		type: "discord",
	});
	console.log("[init] Discord webhook registered");
}

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
