import Elysia from "elysia";

export const webhooksRoutes = new Elysia({ prefix: "/webhooks" }).post(
	"/",
	() => ({ message: "ok" }),
);
