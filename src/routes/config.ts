import Elysia, { t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { config as configTable } from "../db/schema";

type Config = {
	checkIntervalSeconds: number;
	requestTimeoutMs: number;
};

const DEFAULT_CONFIG: Config = {
	checkIntervalSeconds: 15,
	requestTimeoutMs: 3000,
};

let configStore: Config = { ...DEFAULT_CONFIG };
let configRowId: number;

export function getConfig(): Readonly<Config> {
	return configStore;
}

export async function loadConfig() {
	const [row] = await db.select().from(configTable).limit(1);

	if (!row) {
		const [inserted] = await db
			.insert(configTable)
			.values(DEFAULT_CONFIG)
			.returning();
		configRowId = inserted.id;
	} else {
		configRowId = row.id;
		const { checkIntervalSeconds, requestTimeoutMs } = row;
		configStore = { checkIntervalSeconds, requestTimeoutMs };
	}
}

export const configRoutes = new Elysia({ prefix: "/config" })
	.get("/", () => configStore)
	.post(
		"/",
		async ({ body }) => {
			Object.assign(configStore, body);
			await db
				.update(configTable)
				.set(configStore)
				.where(eq(configTable.id, configRowId));
			return configStore;
		},
		{
			body: t.Object({
				checkIntervalSeconds: t.Number(),
				requestTimeoutMs: t.Number(),
			}),
		},
	);
