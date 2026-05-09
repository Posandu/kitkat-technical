import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { proxyTargetStates, proxyTargets } from "../db/schema";

export type ProxyTargetInput = {
  name: string;
  url: string;
  checkIntervalSeconds?: number;
  timeoutMs?: number;
  expectedStatus?: number;
};

export const listProxyTargets = async () => db.select().from(proxyTargets);

export const createProxyTarget = async (input: ProxyTargetInput) => {
  const now = new Date();
  const id = crypto.randomUUID();

  await db.insert(proxyTargets).values({
    id,
    name: input.name,
    url: input.url,
    checkIntervalSeconds: input.checkIntervalSeconds ?? 30,
    timeoutMs: input.timeoutMs ?? 5000,
    expectedStatus: input.expectedStatus ?? 200,
    isActive: true,
    createdAt: now,
    updatedAt: now
  });

  await db.insert(proxyTargetStates).values({
    targetId: id,
    status: "pending",
    updatedAt: now
  });

  const rows = await db.select().from(proxyTargets).where(eq(proxyTargets.id, id)).limit(1);
  return rows[0] ?? null;
};

export const updateProxyTarget = async (
  id: string,
  input: Partial<ProxyTargetInput & { isActive: boolean }>
) => {
  const updatedAt = new Date();
  await db
    .update(proxyTargets)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.checkIntervalSeconds !== undefined ? { checkIntervalSeconds: input.checkIntervalSeconds } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.expectedStatus !== undefined ? { expectedStatus: input.expectedStatus } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt
    })
    .where(eq(proxyTargets.id, id));

  const rows = await db.select().from(proxyTargets).where(eq(proxyTargets.id, id)).limit(1);
  return rows[0] ?? null;
};

export const setProxyTargetState = async (
  targetId: string,
  state: {
    status: "pending" | "up" | "down";
    lastCheckedAt?: Date;
    lastStatusCode?: number | null;
    lastLatencyMs?: number | null;
    lastErrorMessage?: string | null;
  }
) => {
  const updatedAt = new Date();
  await db
    .insert(proxyTargetStates)
    .values({
      targetId,
      status: state.status,
      lastCheckedAt: state.lastCheckedAt,
      lastStatusCode: state.lastStatusCode ?? null,
      lastLatencyMs: state.lastLatencyMs ?? null,
      lastErrorMessage: state.lastErrorMessage ?? null,
      updatedAt
    })
    .onConflictDoUpdate({
      target: proxyTargetStates.targetId,
      set: {
        status: state.status,
        lastCheckedAt: state.lastCheckedAt,
        lastStatusCode: state.lastStatusCode ?? null,
        lastLatencyMs: state.lastLatencyMs ?? null,
        lastErrorMessage: state.lastErrorMessage ?? null,
        updatedAt
      }
    });
};
