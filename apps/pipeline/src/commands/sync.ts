import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db/duck";
import { buildD1Statements, type SyncMode } from "../sync/sql";

/**
 * Generates and executes the D1 statements. Does NOT commit the derived-state table: the caller
 * must call `commitDerivedState(db)` once the whole sync succeeded.
 */
export async function sync(opts: {
  db: Db;
  runId: string;
  manifestCid: string;
  outDir: string;
  exec: (file: string) => Promise<void>;
  mode?: SyncMode;
  /** Incremental: runs since the last successful sync (default `[runId]`). */
  changedRunIds?: string[];
}): Promise<{ files: number; rows: Record<string, number>; mode: SyncMode }> {
  const mode = opts.mode ?? "full";
  const dir = join(opts.outDir, opts.runId, "sync");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const rows: Record<string, number> = {};
  let files = 0;
  for await (const chunk of buildD1Statements(opts.db, {
    manifestCid: opts.manifestCid,
    runId: opts.runId,
    mode,
    ...(opts.changedRunIds ? { changedRunIds: opts.changedRunIds } : {}),
    stats: rows,
  })) {
    const file = join(dir, `${String(files).padStart(4, "0")}.sql`);
    await writeFile(file, chunk);
    await opts.exec(file);
    files++;
  }
  return { files, rows, mode };
}
