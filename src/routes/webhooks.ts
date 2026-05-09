import Elysia, { t } from "elysia";
import { db } from "../db";
import { webhooks } from "../db/schema";

export const webhooksRoutes = new Elysia({ prefix: "/webhooks" }).post(
	"/",
	async ({ body, set }) => {
		const webhookId = `wh-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

		await db.insert(webhooks).values({
			webhookId,
			url: body.url,
			type: "standard",
		});

		set.status = 201;
		return { webhook_id: webhookId, url: body.url };
	},
	{
		body: t.Object({ url: t.String() }, { additionalProperties: true }),
	},
);
