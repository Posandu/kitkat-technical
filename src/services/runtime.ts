import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { runtimeConfig } from "../db/schema";

export type RuntimeConfigSnapshot = {
  cadenceMs: number;
  requestTimeoutMs: number;
  failureThreshold: number;
  updatedAt: Date;
};

const DEFAULT_CONFIG: RuntimeConfigSnapshot = {
  cadenceMs: Number(process.env.PROBE_LOOP_INTERVAL_MS ?? "5000"),
  requestTimeoutMs: Number(process.env.PROBE_REQUEST_TIMEOUT_MS ?? "5000"),
  failureThreshold: Number(process.env.FAILURE_THRESHOLD ?? "0.5"),
  updatedAt: new Date(0)
};

let currentConfig: RuntimeConfigSnapshot = DEFAULT_CONFIG;
const CONFIG_ID = "singleton";

export const getRuntimeConfig = (): RuntimeConfigSnapshot => currentConfig;

export const loadRuntimeConfig = async (): Promise<RuntimeConfigSnapshot> => {
  const rows = await db.select().from(runtimeConfig).where(eq(runtimeConfig.id, CONFIG_ID)).limit(1);
  const row = rows[0];

  if (!row) {
    await db.insert(runtimeConfig).values({
      id: CONFIG_ID,
      cadenceMs: DEFAULT_CONFIG.cadenceMs,
      requestTimeoutMs: DEFAULT_CONFIG.requestTimeoutMs,
      failureThreshold: DEFAULT_CONFIG.failureThreshold,
      updatedAt: new Date()
    });

    currentConfig = { ...DEFAULT_CONFIG, updatedAt: new Date() };
    return currentConfig;
  }

  currentConfig = {
    cadenceMs: row.cadenceMs,
    requestTimeoutMs: row.requestTimeoutMs,
    failureThreshold: row.failureThreshold,
    updatedAt: row.updatedAt
  };

  return currentConfig;
};

export const updateRuntimeConfig = async (input: {
  cadenceMs: number;
  requestTimeoutMs: number;
  failureThreshold: number;
}): Promise<RuntimeConfigSnapshot> => {
  const updatedAt = new Date();

  await db
    .insert(runtimeConfig)
    .values({
      id: CONFIG_ID,
      cadenceMs: input.cadenceMs,
      requestTimeoutMs: input.requestTimeoutMs,
      failureThreshold: input.failureThreshold,
      updatedAt
    })
    .onConflictDoUpdate({
      target: runtimeConfig.id,
      set: {
        cadenceMs: input.cadenceMs,
        requestTimeoutMs: input.requestTimeoutMs,
        failureThreshold: input.failureThreshold,
        updatedAt
      }
    });

  currentConfig = {
    cadenceMs: input.cadenceMs,
    requestTimeoutMs: input.requestTimeoutMs,
    failureThreshold: input.failureThreshold,
    updatedAt
  };

  return currentConfig;
};
