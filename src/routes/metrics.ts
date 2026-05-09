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


// Define proxy structure
type ProxyEntry = {
  id: string;
  url: string;
  status: "up" | "down";
  last_checked_at: string;
  consecutive_failures: number;
};


// Generate dossier statistics
export function getDossierStats(proxies: ProxyEntry[]) {

  // total proxies
  const total = proxies.length;

  // count UP proxies
  const up = proxies.filter(p => p.status === "up").length;

  // count DOWN proxies
  const down = proxies.filter(p => p.status === "down").length;

  // calculate failure rate
  const failure_rate = total === 0 ? 0 : down / total;

  // final response object
  return {
    total,
    up,
    down,
    failure_rate,

    // include full proxy entries
    proxies
  };
}

export const metricsRoutes = new Elysia({ prefix: "/metrics" }).get(
	"/",
	() => ({ message: "ok" }),
);
