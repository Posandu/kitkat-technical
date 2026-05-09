import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { poolIncidents, proxyTargetStates, proxyTargets } from "../db/schema";
import { getRuntimeConfig } from "./runtime";

export const getMonitoringState = async () => {
  const config = getRuntimeConfig();
  const targets = await db.select().from(proxyTargets);
  const states = await db.select().from(proxyTargetStates);
  const openIncidentRows = await db.select().from(poolIncidents).where(eq(poolIncidents.status, "open")).limit(1);

  const targetStates = targets.map((target) => {
    const state = states.find((row) => row.targetId === target.id);
    return {
      target,
      state: state ?? {
        targetId: target.id,
        status: "pending" as const,
        lastCheckedAt: null,
        lastStatusCode: null,
        lastLatencyMs: null,
        lastErrorMessage: null,
        updatedAt: new Date(0)
      }
    };
  });

  const downCount = targetStates.filter((row) => row.state.status === "down").length;
  const totalCount = targetStates.length;
  const failureRate = totalCount === 0 ? 0 : downCount / totalCount;

  return {
    config,
    pool: {
      totalCount,
      downCount,
      failureRate,
      threshold: config.failureThreshold,
      openIncident: openIncidentRows[0] ?? null
    },
    targets: targetStates
  };
};
