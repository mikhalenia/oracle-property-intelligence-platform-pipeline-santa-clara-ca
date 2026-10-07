import { readFile } from "node:fs/promises";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export type Db = {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
};

export async function openDb(path: string): Promise<Db> {
  const instance = await DuckDBInstance.create(path);
  const conn: DuckDBConnection = await instance.connect();
  const bind = async (sql: string, params?: unknown[]) => {
    const prepared = await conn.prepare(sql);
    if (params) prepared.bind(params as never);
    return prepared;
  };
  return {
    async run(sql, params) {
      if (!params) {
        await conn.run(sql);
        return;
      }
      const p = await bind(sql, params);
      await p.run();
    },
    async all<T>(sql: string, params?: unknown[]) {
      const reader = params
        ? await (await bind(sql, params)).runAndReadAll()
        : await conn.runAndReadAll(sql);
      return reader.getRowObjectsJson() as T[];
    },
    async close() {
      conn.closeSync();
      instance.closeSync();
    },
  };
}

export async function applySchema(db: Db): Promise<void> {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  for (const stmt of sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.run(stmt);
}

export const sqlString = (value: string): string => value.replace(/'/g, "''");

/** Runs fn inside a transaction; rolls back and rethrows on error. */
export async function withTransaction<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.run("BEGIN TRANSACTION");
  try {
    const result = await fn();
    await db.run("COMMIT");
    return result;
  } catch (err) {
    await db.run("ROLLBACK");
    throw err;
  }
}
