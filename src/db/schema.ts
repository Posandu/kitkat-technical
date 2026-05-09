import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const config = sqliteTable("config", {
	id: int().primaryKey({ autoIncrement: true }),
	checkIntervalSeconds: int("check_interval_seconds").notNull().default(15),
	requestTimeoutMs: int("request_timeout_ms").notNull().default(3000),
});
