export const FAILURE_THRESHOLD = 0.2;

export function nowISO(): string {
	const d = new Date();
	return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function nowEpochSec(): number {
	return Math.floor(Date.now() / 1000);
}

export function uuid(): string {
	return crypto.randomUUID();
}

/**
 * Derive a proxy ID from the final segment of the proxy URL path.
 * `https://example.com/proxy/px-101` -> `px-101`
 * Falls back to the host when no path segment is present.
 */
export function proxyIdFromUrl(rawUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	const segments = url.pathname.split("/").filter((s) => s.length > 0);
	if (segments.length === 0) return url.host || null;
	return segments[segments.length - 1] || null;
}

export function isTransientStatus(status: number): boolean {
	return status === 500 || status === 502 || status === 503 || status === 504;
}

/** Round to 4 decimal places, returning a JSON-friendly number. */
export function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}
