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

const discordWebhookUrl = Bun.env.DISCORD_WEBHOOK_URL;

if (discordWebhookUrl) {
	const [existingDiscordWebhook] = await db
		.select()
		.from(webhooks)
		.where(eq(webhooks.type, "discord"))
		.limit(1);

	if (existingDiscordWebhook) {
		await db
			.update(webhooks)
			.set({
				url: discordWebhookUrl,
				type: "discord",
				username: null,
				events: null,
			})
			.where(eq(webhooks.webhookId, existingDiscordWebhook.webhookId));
		console.log("[init] Discord webhook updated from DISCORD_WEBHOOK_URL");
	} else {
		await db.insert(webhooks).values({
			webhookId: "discord-primary",
			url: discordWebhookUrl,
			type: "discord",
		});
		console.log("[init] Discord webhook registered from DISCORD_WEBHOOK_URL");
	}
} else {
	console.log("[init] DISCORD_WEBHOOK_URL not set, skipping Discord webhook seed");
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
	.listen({ port: 6969, hostname: "0.0.0.0" });

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
