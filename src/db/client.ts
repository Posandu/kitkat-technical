import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

const sqlitePath = process.env.SQLITE_PATH ?? "./sqlite.db";

export const sqlite = new Database(sqlitePath, { create: true });
export const db = drizzle(sqlite);
