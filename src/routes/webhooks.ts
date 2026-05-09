import { Elysia, t } from "elysia";

import { enqueueDelivery, getIntegrationById } from "../services/delivery";
import {
  buildDiscordPayload,
  buildSlackPayload,
  buildStandardPayload
} from "../services/payloads";

export const webhookRoutes = new Elysia().post(
  "/webhooks",
  async ({ body, set }) => {
    const integration = await getIntegrationById(body.integrationId);

    if (!integration) {
      set.status = 404;
      return { message: "integrationId not found" };
    }

    const standardPayload = buildStandardPayload(body.eventType, body.alert);
    const providerPayload =
      integration.kind === "slack"
        ? buildSlackPayload(standardPayload)
        : buildDiscordPayload(standardPayload);

    const eventId = await enqueueDelivery(
      integration.id,
      body.eventType,
      standardPayload,
      providerPayload
    );

    set.status = 202;
    return {
      status: "accepted",
      eventId
    };
  },
  {
    body: t.Object({
      integrationId: t.String({ minLength: 1 }),
      eventType: t.Union([t.Literal("alert.fired"), t.Literal("alert.resolved")]),
      alert: t.Object({
        alertId: t.String({ minLength: 1 }),
        title: t.String({ minLength: 1 }),
        description: t.String({ minLength: 1 }),
        severity: t.Union([
          t.Literal("critical"),
          t.Literal("high"),
          t.Literal("medium"),
          t.Literal("low"),
          t.Literal("info")
        ]),
        source: t.String({ minLength: 1 }),
        occurredAt: t.Optional(t.String({ format: "date-time" }))
      })
    }),
    detail: {
      tags: ["Webhooks"],
      summary: "Accept alert events and queue fire-and-forget delivery"
    }
  }
);
