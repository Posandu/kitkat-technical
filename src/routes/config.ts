import Elysia from "elysia";

export const configRoutes = new Elysia({ prefix: "/config" })
	.get("/", () => ({ message: "ok" }))
	.post("/", () => ({ message: "ok" }));
