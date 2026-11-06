import type { Db } from "../../api/src/db/db";

// better-sqlite3's shape on top of Durable Object SQLite, so the API's database helpers run unchanged.
export function sqlDb(storage: DurableObjectStorage): Db {
  const { sql } = storage;
  const run = (query: string, params: unknown[]) => {
    try {
      return sql.exec(query, ...params);
    } catch (e) {
      // createApplication looks for better-sqlite3's error code to spot a duplicate open application.
      if ((e as Error).message.includes("UNIQUE constraint failed")) Object.assign(e as Error, { code: "SQLITE_CONSTRAINT_UNIQUE" });
      throw e;
    }
  };
  return {
    exec: (query) => sql.exec(query),
    transaction: (fn) => () => storage.transactionSync(fn),
    prepare: (query) => ({
      run(...params) {
        const cursor = run(query, params);
        cursor.toArray(); // the counts are only final once the cursor is read
        const { id } = sql.exec<{ id: number }>("SELECT last_insert_rowid() AS id").one();
        return { changes: cursor.rowsWritten, lastInsertRowid: id };
      },
      get: (...params) => run(query, params).toArray()[0],
      all: (...params) => run(query, params).toArray(),
    }),
  };
}
