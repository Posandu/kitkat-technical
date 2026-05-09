import Elysia from "elysia";

export const metricsRoutes = new Elysia({ prefix: "/metrics" }).get(
	"/",
	() => ({ message: "ok" }),
);
