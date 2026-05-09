import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { checkHistory, proxyTargetStates, proxyTargets } from "../db/schema";
import { getRuntimeConfig, loadRuntimeConfig, type RuntimeConfigSnapshot } from "../services/runtime";
import { evaluatePoolIncident, getOpenPoolIncident } from "../services/incident";
import { setProxyTargetState } from "../services/proxy-targets";

let sweepTimer: ReturnType<typeof setTimeout> | null = null;
let sweepInFlight = false;
let bootstrapped = false;

const deriveTargetStatus = (ok: boolean): "up" | "down" => (ok ? "up" : "down");

const runProbe = async (target: typeof proxyTargets.$inferSelect, config: RuntimeConfigSnapshot) => {
  const startedAt = Date.now();
  let ok = false;
  let statusCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    const response = await fetch(target.url, {
      method: "GET",
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    statusCode = response.status;
    ok = response.status === target.expectedStatus;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unknown probe error";
  }

  const latencyMs = Date.now() - startedAt;
  const checkedAt = new Date();
  const status = deriveTargetStatus(ok);

  await db.insert(checkHistory).values({
    id: crypto.randomUUID(),
    targetId: target.id,
    ok,
    statusCode,
    latencyMs,
    errorMessage,
    checkedAt
  });

  await setProxyTargetState(target.id, {
    status,
    lastCheckedAt: checkedAt,
    lastStatusCode: statusCode,
    lastLatencyMs: latencyMs,
    lastErrorMessage: errorMessage
  });
};

const getPoolSummary = async (config: RuntimeConfigSnapshot) => {
  const targets = await db.select().from(proxyTargets).where(eq(proxyTargets.isActive, true));
  const states = await db.select().from(proxyTargetStates);
  const totalCount = targets.length;
  const downCount = states.filter((state) => state.status === "down").length;
  const failureRate = totalCount === 0 ? 0 : downCount / totalCount;
  const openIncident = await getOpenPoolIncident();

  return {
    failureRate,
    threshold: config.failureThreshold,
    downCount,
    totalCount,
    openIncident
  };
};

export const runProbeSweep = async () => {
  if (sweepInFlight) {
    return;
  }

  sweepInFlight = true;
  try {
    const config = await loadRuntimeConfig();
    const targets = await db.select().from(proxyTargets).where(eq(proxyTargets.isActive, true));

    await Promise.allSettled(targets.map((target) => runProbe(target, config)));

    await evaluatePoolIncident(await getPoolSummary(config));
  } finally {
    sweepInFlight = false;
  }
};

const scheduleNextSweep = (delayMs: number) => {
  if (sweepTimer) {
    clearTimeout(sweepTimer);
  }

  sweepTimer = setTimeout(() => {
    void runProbeSweep().finally(() => {
      const nextConfig = getRuntimeConfig();
      scheduleNextSweep(nextConfig.cadenceMs);
    });
  }, delayMs);
};

export const startWatchmanLoop = async () => {
  if (bootstrapped) {
    return;
  }

  bootstrapped = true;
  await loadRuntimeConfig();
  await runProbeSweep();
  scheduleNextSweep(getRuntimeConfig().cadenceMs);
};

export const rescheduleWatchmanLoop = () => {
  const config = getRuntimeConfig();
  scheduleNextSweep(config.cadenceMs);
};
