import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

import { configRoutes } from "./routes/config";
import { integrationsRoutes } from "./routes/integrations";
import { proxyTargetRoutes } from "./routes/proxy-targets";
import { stateRoutes } from "./routes/state";
import { webhookRoutes } from "./routes/webhooks";
import { startWatchmanLoop } from "./watchman/probes";
import { loadRuntimeConfig } from "./services/runtime";

const app = new Elysia()
  .use(
    swagger({
      documentation: {
        info: {
          title: "Proxy Maze Core Engine",
          version: "1.0.0"
        },
        tags: [
          { name: "Integrations", description: "Manage Slack/Discord webhooks" },
          { name: "Webhooks", description: "Queue alert events" }
        ]
      }
    })
  )
  .get("/health", () => ({ status: "ok" }))
  .use(configRoutes)
  .use(proxyTargetRoutes)
  .use(integrationsRoutes)
  .use(stateRoutes)
  .use(webhookRoutes);

void loadRuntimeConfig();
void startWatchmanLoop();

const port = Number(process.env.PORT ?? "3000");

app.listen(port);
console.log(`Proxy Maze Core Engine listening on :${port}`);
