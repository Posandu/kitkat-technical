import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

const sqlite = new Database("sqlite.db");

// Enable WAL mode for better concurrency
sqlite.exec("PRAGMA journal_mode = WAL;");
// Set busy timeout to 5 seconds
sqlite.exec("PRAGMA busy_timeout = 5000;");

export const db = drizzle({ client: sqlite, schema });
