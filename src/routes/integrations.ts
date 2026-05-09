import { Elysia, t } from "elysia";

import { createIntegration } from "../services/delivery";
import { importSampleWebhookIntegrations } from "../services/webhook-samples";

export const integrationsRoutes = new Elysia().post(
  "/integrations",
  async ({ body, set }) => {
    const integration = await createIntegration(body.name, body.kind, body.webhookUrl);
    set.status = 201;

    return {
      id: integration.id,
      name: integration.name,
      kind: integration.kind,
      webhookUrl: integration.webhookUrl,
      createdAt: integration.createdAt
    };
  },
  {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      kind: t.Union([t.Literal("slack"), t.Literal("discord")]),
      webhookUrl: t.String({ format: "uri", minLength: 1 })
    }),
    detail: {
      tags: ["Integrations"],
      summary: "Register a Slack or Discord integration"
    }
  }
).post(
  "/integrations/import",
  async ({ set }) => {
    const imported = await importSampleWebhookIntegrations();
    set.status = 200;

    return {
      status: "ok",
      importedCount: imported.length,
      imported
    };
  },
  {
    detail: {
      tags: ["Integrations"],
      summary: "Import sample Slack and Discord webhook integrations from txt files"
    }
  }
);
