import Elysia from "elysia";

export const alertsRoutes = new Elysia({ prefix: "/alerts" }).get(
	"/",
	() => ({ message: "ok" }),
);
