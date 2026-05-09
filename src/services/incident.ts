import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { integrations, poolIncidents } from "../db/schema";
import { enqueueDelivery } from "./delivery";
import { buildDiscordPayload, buildSlackPayload, buildStandardPayloadForIncident } from "./payloads";

export type PoolIncidentSnapshot = {
  id: string;
  status: "open" | "resolved";
  failureRate: number;
  threshold: number;
  downCount: number;
  totalCount: number;
  openedAt: Date;
  resolvedAt: Date | null;
};

export type PoolStateSummary = {
  failureRate: number;
  threshold: number;
  downCount: number;
  totalCount: number;
  openIncident: PoolIncidentSnapshot | null;
};

type PoolIncidentSeed = {
  failureRate: number;
  threshold: number;
  downCount: number;
  totalCount: number;
  openedAt: Date;
};

const activeIntegrationRows = async () => db.select().from(integrations);

export const getOpenPoolIncident = async (): Promise<PoolIncidentSnapshot | null> => {
  const rows = await db.select().from(poolIncidents).where(eq(poolIncidents.status, "open")).limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    status: row.status,
    failureRate: row.failureRate,
    threshold: row.threshold,
    downCount: row.downCount,
    totalCount: row.totalCount,
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt ?? null
  };
};

const createPoolIncident = async (summary: PoolIncidentSeed) => {
  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(poolIncidents).values({
    id,
    status: "open",
    failureRate: summary.failureRate,
    threshold: summary.threshold,
    downCount: summary.downCount,
    totalCount: summary.totalCount,
    openedAt: summary.openedAt,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now
  });

  const standardPayload = buildStandardPayloadForIncident("alert.fired", {
    id,
    status: "open",
    failureRate: summary.failureRate,
    threshold: summary.threshold,
    downCount: summary.downCount,
    totalCount: summary.totalCount,
    openedAt: summary.openedAt,
    resolvedAt: null
  });

  const integrationsList = await activeIntegrationRows();
  for (const integration of integrationsList) {
    const providerPayload = integration.kind === "slack" ? buildSlackPayload(standardPayload) : buildDiscordPayload(standardPayload);
    await enqueueDelivery(integration.id, "alert.fired", standardPayload, providerPayload, id);
  }

  return id;
};

const resolvePoolIncident = async (incident: PoolIncidentSnapshot) => {
  const resolvedAt = new Date();
  await db
    .update(poolIncidents)
    .set({
      status: "resolved",
      resolvedAt,
      updatedAt: resolvedAt
    })
    .where(eq(poolIncidents.id, incident.id));

  const standardPayload = buildStandardPayloadForIncident("alert.resolved", {
    ...incident,
    status: "resolved",
    resolvedAt
  });

  const integrationsList = await activeIntegrationRows();
  for (const integration of integrationsList) {
    const providerPayload = integration.kind === "slack" ? buildSlackPayload(standardPayload) : buildDiscordPayload(standardPayload);
    await enqueueDelivery(integration.id, "alert.resolved", standardPayload, providerPayload, incident.id);
  }
};

export const evaluatePoolIncident = async (summary: PoolStateSummary) => {
  const openIncident = summary.openIncident;

  if (summary.totalCount === 0) {
    if (openIncident) {
      await resolvePoolIncident(openIncident);
    }
    return;
  }

  if (summary.failureRate >= summary.threshold && !openIncident) {
    await createPoolIncident({
      failureRate: summary.failureRate,
      threshold: summary.threshold,
      downCount: summary.downCount,
      totalCount: summary.totalCount,
      openedAt: new Date()
    });
    return;
  }

  if (summary.failureRate < summary.threshold && openIncident) {
    await resolvePoolIncident(openIncident);
  }
};
