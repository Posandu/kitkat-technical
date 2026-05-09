import Elysia from "elysia";

<<<<<<< HEAD
// UP / DOWN status
export function classifyHealth(statusCode?: number, error?: string): "UP" | "DOWN" {

  if (error) return "DOWN";

  // If status code exists
  if (statusCode) {

    if (statusCode >= 200 && statusCode < 300) {
      return "UP";
    }

    // everything else = DOWN
    return "DOWN";
  }

  // default
  return "DOWN";
}

export const healthRoutes = new Elysia({ prefix: "/health" }).get(
	"/",
	() => ({ status: "ok" }),
);
=======
export const healthRoutes = new Elysia({ prefix: "/health" }).get("/", () => ({
	status: "ok",
}));
>>>>>>> bb1e12918690a0010f5f4c68bbe9afd55e21d3ec
