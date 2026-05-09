import Elysia from "elysia";

// Converts to UP / DOWN status
export function classifyHealth(statusCode?: number, error?: string): "UP" | "DOWN" {

  // If there is an error → DOWN
  if (error) return "DOWN";

  // If status code exists
  if (statusCode) {

    if (statusCode >= 200 && statusCode < 300) {
      return "UP";
    }

    // everything else = DOWN
    return "DOWN";
  }

  // default fallback
  return "DOWN";
}

export const healthRoutes = new Elysia({ prefix: "/health" }).get(
  "/",
  () => ({status: "ok",})
);

