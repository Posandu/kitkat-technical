import { Elysia } from "elysia";
import { listWebhooks, registerWebhook, type WebhookType } from "../webhooks";

function isWebhookType(v: unknown): v is WebhookType {
	return v === "generic" || v === "slack" || v === "discord";
}

export const webhooksRoutes = new Elysia()
	.post("/webhooks", ({ body, set }) => {
		if (!body || typeof body !== "object") {
			set.status = 400;
			return { error: "invalid_body", message: "expected JSON object" };
		}
		const b = body as Record<string, unknown>;
		const url = b.url;
		if (typeof url !== "string" || url.length === 0) {
			set.status = 400;
			return { error: "invalid_url", message: "`url` is required" };
		}
		try {
			new URL(url);
		} catch {
			set.status = 400;
			return { error: "invalid_url", message: "`url` must be a valid URL" };
		}
		const type: WebhookType = isWebhookType(b.type) ? b.type : "generic";
		const username = typeof b.username === "string" ? b.username : null;
		const wh = registerWebhook({ url, type, username });
		set.status = 201;
		return wh;
	})
	.get("/webhooks", () => listWebhooks());
