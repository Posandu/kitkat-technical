import Elysia from "elysia";

// Extracts ID from the URL
export function extractProxyId(url: string): string {
  
  // Split URL by "/"
  const parts = url.split("/");

  return parts[parts.length - 1];
}

export const proxiesRoutes = new Elysia({ prefix: "/proxies" })
	.get("/", () => ({ message: "ok" }))
	.post("/", () => ({ message: "ok" }))
	.delete("/", () => ({ message: "ok" }))
	.get("/:id", ({ params }) => ({ message: "ok", id: params.id }))
	.get("/:id/history", ({ params }) => ({ message: "ok", id: params.id }));

