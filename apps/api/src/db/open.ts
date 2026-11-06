import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { migrate, type Db } from "./db";

// Opens (or creates) the database and applies the schema. ":memory:" gives a throwaway database for tests.
export function openDb(path = process.env.DATABASE_PATH ?? "app.db"): Db & { close(): void } {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const wrapped = db as unknown as Db & { close(): void };
  migrate(wrapped, readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  return wrapped;
}
