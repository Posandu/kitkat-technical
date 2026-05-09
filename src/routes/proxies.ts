import Elysia from "elysia";

export const proxiesRoutes = new Elysia({ prefix: "/proxies" })
	.get("/", () => ({ message: "ok" }))
	.post("/", () => ({ message: "ok" }))
	.delete("/", () => ({ message: "ok" }))
	.get("/:id", ({ params }) => ({ message: "ok", id: params.id }))
	.get("/:id/history", ({ params }) => ({ message: "ok", id: params.id }));
