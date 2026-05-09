import Elysia from "elysia";

export const integrationsRoutes = new Elysia({ prefix: "/integrations" }).post(
	"/",
	() => ({ message: "ok" }),
);
