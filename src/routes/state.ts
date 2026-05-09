import { Elysia } from "elysia";

import { getMonitoringState } from "../services/state";

export const stateRoutes = new Elysia().get("/state", async () => getMonitoringState(), {
  detail: {
    tags: ["State"],
    summary: "Read canonical monitoring state"
  }
});
