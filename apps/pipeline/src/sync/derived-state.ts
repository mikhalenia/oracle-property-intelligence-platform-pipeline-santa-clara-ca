import { createHash } from "node:crypto";
import { withTransaction, type Db } from "../db/duck";
import { sqlLiteral } from "./batch";

/** Provenance columns that change on every refetch without any data change; left out of the hash. */
const HASH_EXCLUDE = new Set(["fetched_at", "source_version"]);

/** sha256 of the JSON array of a row's column values (provenance volatility excluded). */
export function hashRow(columns: readonly string[], r: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(columns.filter((c) => !HASH_EXCLUDE.has(c)).map((c) => r[c] ?? null)))
    .digest("hex");
}

/** Buffers (key, hash) pairs for one table into derived_sync_pending. */
export class PendingWriter {
  private buf: string[] = [];
  constructor(
    private readonly db: Db,
    private readonly table: string,
  ) {}
  async add(key: string, hash: string): Promise<void> {
    this.buf.push(`(${sqlLiteral(this.table)}, ${sqlLiteral(key)}, ${sqlLiteral(hash)})`);
    if (this.buf.length >= 500) await this.flush();
  }
  async flush(): Promise<void> {
    if (this.buf.length === 0) return;
    await this.db.run(`INSERT INTO derived_sync_pending VALUES ${this.buf.join(", ")}`);
    this.buf = [];
  }
}

/** Empties the staging table; call before computing a new state. */
export const resetPendingState = (db: Db): Promise<void> =>
  db.run("DELETE FROM derived_sync_pending");

/** Committed state, keyed by `table\0key`. */
export async function loadStoredState(db: Db): Promise<Map<string, string>> {
  const stored = new Map<string, string>();
  for (const r of await db.all<{ t: string; k: string; h: string }>(
    'SELECT "table" AS t, key AS k, row_hash AS h FROM derived_sync_state',
  ))
    stored.set(`${r.t}\u0000${r.k}`, r.h);
  return stored;
}

/**
 * Replaces `derived_sync_state` with the state computed by the last `buildD1Statements` run.
 * Call only after every statement was executed successfully against D1.
 */
export async function commitDerivedState(db: Db): Promise<void> {
  await withTransaction(db, async () => {
    await db.run("DELETE FROM derived_sync_state");
    await db.run("INSERT INTO derived_sync_state SELECT * FROM derived_sync_pending");
  });
}

/**
 * Computes and commits derived_sync_state WITHOUT generating statements, as if a full sync had just
 * completed. Use when D1 already holds the snapshot for this data.
 */
export async function bootstrapState(
  db: Db,
  tables: readonly string[],
  rows: (table: string) => AsyncIterable<{ key: string; hash: string }>,
): Promise<number> {
  await resetPendingState(db);
  for (const t of tables) {
    const w = new PendingWriter(db, t);
    for await (const r of rows(t)) await w.add(r.key, r.hash);
    await w.flush();
  }
  await commitDerivedState(db);
  return (await db.all<{ n: number }>("SELECT count(*)::INT AS n FROM derived_sync_state"))[0]!.n;
}
