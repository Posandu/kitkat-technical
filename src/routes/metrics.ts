import Elysia from "elysia";


// Calculates failure rate
export function calculateFailureRate(results: boolean[]): number {

  // total checks
  const total = results.length;

  // if no data, return 0
  if (total === 0) return 0;

  // count failures (false = DOWN)
  const down = results.filter(r => r === false).length;

  // math formula: down / total
  return down / total;
}


export const metricsRoutes = new Elysia({ prefix: "/metrics" }).get(
	"/",
	() => ({ message: "ok" }),
);
