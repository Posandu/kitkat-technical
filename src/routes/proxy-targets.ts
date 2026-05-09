import { Elysia, t } from "elysia";

import { createProxyTarget, listProxyTargets, updateProxyTarget } from "../services/proxy-targets";

export const proxyTargetRoutes = new Elysia()
  .get("/proxy-targets", async () => listProxyTargets(), {
    detail: {
      tags: ["Proxy Targets"],
      summary: "List monitored proxy URLs"
    }
  })
  .post(
    "/proxy-targets",
    async ({ body, set }) => {
      const target = await createProxyTarget(body);
      set.status = 201;
      return target;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        url: t.String({ format: "uri", minLength: 1 }),
        checkIntervalSeconds: t.Optional(t.Integer({ minimum: 1 })),
        timeoutMs: t.Optional(t.Integer({ minimum: 100 })),
        expectedStatus: t.Optional(t.Integer({ minimum: 100, maximum: 599 }))
      }),
      detail: {
        tags: ["Proxy Targets"],
        summary: "Register a proxy URL for continuous monitoring"
      }
    }
  )
  .patch(
    "/proxy-targets/:id",
    async ({ params, body }) => updateProxyTarget(params.id, body),
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        url: t.Optional(t.String({ format: "uri", minLength: 1 })),
        isActive: t.Optional(t.Boolean()),
        checkIntervalSeconds: t.Optional(t.Integer({ minimum: 1 })),
        timeoutMs: t.Optional(t.Integer({ minimum: 100 })),
        expectedStatus: t.Optional(t.Integer({ minimum: 100, maximum: 599 }))
      }),
      detail: {
        tags: ["Proxy Targets"],
        summary: "Update a proxy target"
      }
    }
  );
