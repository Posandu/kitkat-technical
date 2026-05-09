import Elysia, { t } from "elysia";
import { db } from "../db";
import { webhooks } from "../db/schema";

export const integrationsRoutes = new Elysia({ prefix: "/integrations" }).post(
	"/",
	async ({ body, set }) => {
		const webhookId = `wh-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

		await db.insert(webhooks).values({
			webhookId,
			url: body.webhook_url,
			type: body.type,
			username: body.username ?? null,
			events: body.events ? JSON.stringify(body.events) : null,
		});

		set.status = 201;
		return {
			webhook_id: webhookId,
			type: body.type,
			url: body.webhook_url,
		};
	},
	{
		body: t.Object(
			{
				type: t.Union([t.Literal("slack"), t.Literal("discord")]),
				webhook_url: t.String(),
				username: t.Optional(t.String()),
				events: t.Optional(t.Array(t.String())),
			},
			{ additionalProperties: true },
		),
	},
);
