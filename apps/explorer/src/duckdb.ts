import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import { VENDOR_GATEWAY, gatewayUrl } from "./gateways";

let dbPromise: Promise<AsyncDuckDB> | null = null;

/** Lazy singleton: the WASM bundle is only fetched on the first call. */
export function initDuckDb(): Promise<AsyncDuckDB> {
  dbPromise ??= (async () => {
    // Dynamic import keeps the DuckDB-WASM JS out of the main bundle until the first Run.
    const duckdb = await import("@duckdb/duckdb-wasm");
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const worker = new Worker(
      URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
      ),
    );
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return db;
  })();
  return dbPromise;
}

export function resolveSql(template: string, base: string): string {
  return template.replaceAll("{{base}}", base);
}

/**
 * Data-profile ruling: the long-open roofing example must also count expired-unfinaled permits.
 * Published sql-examples.json may still say `= 'open'`; patch it client-side.
 */
export function patchOpenPermitExample(sql: string): string {
  return sql.replaceAll("permit_state = 'open'", "permit_state IN ('open','expired_unfinaled')");
}

export interface SqlExample {
  id: string;
  title: string;
  sql: string;
}

export const baseFor = (rootCid: string) => gatewayUrl(rootCid, VENDOR_GATEWAY);

export async function loadExamples(rootCid: string): Promise<SqlExample[]> {
  const res = await fetch(gatewayUrl(rootCid, VENDOR_GATEWAY, "sql-examples.json"));
  if (!res.ok) throw new Error(`sql-examples.json responded ${res.status}`);
  const items = (await res.json()) as SqlExample[];
  return items.map((e) => ({ ...e, sql: patchOpenPermitExample(e.sql) }));
}

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
}

function cell(v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

export async function runSql(sql: string): Promise<SqlResult> {
  const db = await initDuckDb();
  const conn = await db.connect();
  try {
    const table = await conn.query(sql);
    const columns = table.schema.fields.map((f) => f.name);
    const rows = table.toArray().map((r) => {
      const o = r.toJSON() as Record<string, unknown>;
      return columns.map((c) => cell(o[c]));
    });
    return { columns, rows };
  } finally {
    await conn.close();
  }
}
