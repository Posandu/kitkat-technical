import Elysia, { t } from "elysia";
import { db } from "../db";
import { proxies as proxiesTable } from "../db/schema";

function extractId(rawUrl: string): string {
	try {
		const segments = new URL(rawUrl).pathname.split("/").filter(Boolean);
		return segments[segments.length - 1] ?? rawUrl;
	} catch {
		return rawUrl.split("/").filter(Boolean).pop() ?? rawUrl;
	}
}

export const proxiesRoutes = new Elysia({ prefix: "/proxies" })
	.get("/", async () => {
		const rows = await db.select().from(proxiesTable);

		const up = rows.filter((r) => r.status === "up").length;
		const down = rows.filter((r) => r.status === "down").length;
		const total = rows.length;
		const failure_rate = total > 0 ? down / total : 0;

		return {
			total,
			up,
			down,
			failure_rate,
			proxies: rows.map((r) => ({
				id: r.id,
				url: r.url,
				status: r.status,
				last_checked_at: r.lastCheckedAt,
				consecutive_failures: r.consecutiveFailures,
			})),
		};
	})
	.post(
		"/",
		async ({ body, set }) => {
			const { proxies, replace } = body;

			if (replace) {
				await db.delete(proxiesTable);
			}

			const rows = proxies.map((url) => ({
				id: extractId(url),
				url,
				status: "pending" as const,
			}));

			const inserted = await db
				.insert(proxiesTable)
				.values(rows)
				.onConflictDoNothing()
				.returning({
					id: proxiesTable.id,
					url: proxiesTable.url,
					status: proxiesTable.status,
				});

			set.status = 201;
			return {
				accepted: inserted.length,
				proxies: inserted,
			};
		},
		{
			body: t.Object(
				{
					proxies: t.Array(t.String()),
					replace: t.Optional(t.Boolean()),
				},
				{ additionalProperties: true },
			),
		},
	)
	.delete("/", async ({ set }) => {
		await db.delete(proxiesTable);
		set.status = 204;
	})
	.get("/:id", ({ params }) => ({ message: "ok", id: params.id }))
	.get("/:id/history", ({ params }) => ({ message: "ok", id: params.id }));
