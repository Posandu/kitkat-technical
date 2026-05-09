import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { integrations, webhookEvents } from "../db/schema";
import type { IntegrationKind } from "../types";

const deliveryTimeoutMs = Number(process.env.DELIVERY_TIMEOUT_MS ?? "10000");
const maxRetries = Number(process.env.DELIVERY_MAX_RETRIES ?? "5");
const retryBaseDelayMs = Number(process.env.DELIVERY_RETRY_BASE_DELAY_MS ?? "1000");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetry = (status: number | null) => {
  if (status === null) {
    return true;
  }

  return status === 408 || status === 425 || status === 429 || status >= 500;
};

export const enqueueDelivery = async (
  integrationId: string,
  eventType: "alert.fired" | "alert.resolved",
  standardPayload: unknown,
  providerPayload: unknown,
  correlationId?: string
) => {
  const id = crypto.randomUUID();

  await db.insert(webhookEvents).values({
    id,
    integrationId,
    correlationId: correlationId ?? null,
    eventType,
    payloadJson: JSON.stringify(standardPayload),
    providerPayloadJson: JSON.stringify(providerPayload),
    status: "queued",
    attemptCount: 0,
    createdAt: new Date()
  });

  // Fire-and-forget async delivery driven by Bun event loop.
  queueMicrotask(() => void deliverEvent(id));

  return id;
};

export const deliverEvent = async (webhookEventId: string): Promise<void> => {
  const rows = await db
    .select({
      event: webhookEvents,
      integration: integrations
    })
    .from(webhookEvents)
    .innerJoin(integrations, eq(webhookEvents.integrationId, integrations.id))
    .where(eq(webhookEvents.id, webhookEventId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return;
  }

  const event = row.event;
  const integration = row.integration;
  const providerPayload = JSON.parse(event.providerPayloadJson);

  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt += 1;

    let statusCode: number | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), deliveryTimeoutMs);

      const response = await fetch(integration.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(providerPayload),
        signal: controller.signal
      });

      clearTimeout(timeout);
      statusCode = response.status;

      if (response.ok) {
        await db
          .update(webhookEvents)
          .set({
            status: "delivered",
            attemptCount: attempt,
            deliveredAt: new Date(),
            errorMessage: null
          })
          .where(eq(webhookEvents.id, webhookEventId));

        return;
      }

      if (!shouldRetry(statusCode)) {
        const bodyText = await response.text();
        await db
          .update(webhookEvents)
          .set({
            status: "failed",
            attemptCount: attempt,
            errorMessage: `Permanent failure ${statusCode}: ${bodyText.slice(0, 300)}`
          })
          .where(eq(webhookEvents.id, webhookEventId));
        return;
      }
    } catch (error) {
      statusCode = null;
      if (attempt > maxRetries) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await db
          .update(webhookEvents)
          .set({
            status: "failed",
            attemptCount: attempt,
            errorMessage: `Transient failure after retries: ${message}`
          })
          .where(eq(webhookEvents.id, webhookEventId));
        return;
      }
    }

    if (attempt > maxRetries) {
      await db
        .update(webhookEvents)
        .set({
          status: "failed",
          attemptCount: attempt,
          errorMessage: `Transient failure after retries. Last status: ${statusCode ?? "network error"}`
        })
        .where(eq(webhookEvents.id, webhookEventId));
      return;
    }

    const delayMs = retryBaseDelayMs * 2 ** (attempt - 1);
    await sleep(delayMs);
  }
};

export const getIntegrationById = async (id: string) => {
  const rows = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
  return rows[0] ?? null;
};

export const createIntegration = async (
  name: string,
  kind: IntegrationKind,
  webhookUrl: string
) => {
  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(integrations).values({
    id,
    name,
    kind,
    webhookUrl,
    createdAt: now
  });

  const inserted = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
  return inserted[0];
};
