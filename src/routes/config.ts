import { Elysia, t } from "elysia";

import { rescheduleWatchmanLoop } from "../watchman/probes";
import { getRuntimeConfig, updateRuntimeConfig } from "../services/runtime";

export const configRoutes = new Elysia()
  .get("/config", () => getRuntimeConfig(), {
    detail: {
      tags: ["Config"],
      summary: "Read current monitoring cadence and timeout"
    }
  })
  .patch(
    "/config",
    async ({ body }) => {
      const updated = await updateRuntimeConfig(body);
      rescheduleWatchmanLoop();
      return updated;
    },
    {
      body: t.Object({
        cadenceMs: t.Integer({ minimum: 1000 }),
        requestTimeoutMs: t.Integer({ minimum: 100 }),
        failureThreshold: t.Number({ minimum: 0, maximum: 1 })
      }),
      detail: {
        tags: ["Config"],
        summary: "Update monitoring cadence and timeout immediately"
      }
    }
  );
