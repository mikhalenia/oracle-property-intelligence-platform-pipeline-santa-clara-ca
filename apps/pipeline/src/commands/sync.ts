import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db/duck";
import { bootstrapDerivedState, buildD1Statements, type SyncMode } from "../sync/sql";
import { chooseMode, readSyncState, writeSyncState } from "../sync/state";

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

/**
 * Records local sync state as if a full sync of `runId` had just completed, writing NOTHING to D1.
 * For when D1 already holds that run's complete snapshot (e.g. full syncs done before state tracking
 * existed). Refuses unless `runId` is the newest run and is published, so local tables match D1.
 */
export async function bootstrapSyncState(opts: {
  db: Db;
  dataDir: string;
  runId?: string | undefined;
}): Promise<{ runId: string; stateRows: number }> {
  const latest = (
    await opts.db.all<{ run_id: string; manifest_cid: string | null }>(
      "SELECT run_id, manifest_cid FROM runs ORDER BY started_at DESC LIMIT 1",
    )
  )[0];
  if (!latest) throw new Error("no runs found; run ingest first");
  const runId = opts.runId ?? latest.run_id;
  if (latest.run_id !== runId || !latest.manifest_cid)
    throw new Error(
      `cannot bootstrap: run ${runId} must be the newest local run and published (newest is ${latest.run_id}${latest.manifest_cid ? "" : ", unpublished"})`,
    );
  const stateRows = await bootstrapDerivedState(opts.db);
  await writeSyncState(opts.dataDir, {
    runId,
    mode: "full",
    syncedAt: new Date().toISOString(),
    rowsWritten: 0,
    bootstrapped: true,
  });
  return { runId, stateRows };
}

/** Run id in D1's `snapshot` row, from `wrangler d1 execute --json` output (null when empty). */
export function parseD1SnapshotRunId(stdout: string): string | null {
  try {
    // tolerate banner lines around the JSON array
    const json = stdout.slice(stdout.indexOf("["), stdout.lastIndexOf("]") + 1);
    const out = JSON.parse(json) as Array<{ results?: Array<{ run_id?: unknown }> }>;
    const runId = out[0]?.results?.[0]?.run_id;
    return typeof runId === "string" ? runId : null;
  } catch (err) {
    throw new Error(`unexpected wrangler output: ${stdout.slice(0, 200)}`, { cause: err });
  }
}

/**
 * Picks the sync mode for `runId`. Incremental needs the marker from a previous successful sync, a
 * populated derived_sync_state, and a marker run that is not newer than the target. When the marker
 * run IS the target (re-sync), nothing is pushed except the runs/snapshot upserts.
 *
 * A full sync starts by deleting every D1 table and exceeds the daily write budget, so an implicit
 * full sync (no `full: true`) is REFUSED when D1 already holds a snapshot: the operator either
 * bootstraps the local state from that snapshot or passes `--full` deliberately. Incremental is
 * refused when D1 holds a different run than the local marker (the diff would be against the wrong base).
 */
export async function planSync(opts: {
  db: Db;
  dataDir: string;
  runId: string;
  full: boolean;
  /** Probe for the run id in D1's snapshot row (null when D1 has none). */
  d1SnapshotRunId: () => Promise<string | null>;
}): Promise<{ mode: SyncMode; changedRunIds: string[]; alreadySyncedRun?: string }> {
  const state = await readSyncState(opts.dataDir);
  const derivedStateRows = Number(
    (await opts.db.all<{ n: number }>("SELECT count(*) AS n FROM derived_sync_state"))[0]?.n ?? 0,
  );
  let changedRunIds: string[] = [];
  let known = false;
  if (state && state.runId === opts.runId) known = true;
  else if (state) {
    changedRunIds = (
      await opts.db.all<{ run_id: string }>(
        `SELECT run_id FROM runs WHERE started_at > (SELECT started_at FROM runs WHERE run_id = ?)
         AND started_at <= (SELECT started_at FROM runs WHERE run_id = ?) ORDER BY started_at`,
        [state.runId, opts.runId],
      )
    ).map((r) => r.run_id);
    known = changedRunIds.length > 0;
  }
  const mode = chooseMode({ full: opts.full, derivedStateRows, lastSyncedRunKnown: known }, state);
  if (!opts.full) {
    const d1RunId = await opts.d1SnapshotRunId();
    if (mode === "full" && d1RunId) {
      const why = state
        ? `the local sync state cannot diff against it (marker ${state.runId}, ${derivedStateRows} state rows)`
        : "the local sync marker (data/d1-sync-state.json) is missing";
      throw new Error(
        `refusing a full D1 sync: D1 already holds the snapshot of run ${d1RunId} and ${why}. ` +
          `A full sync deletes every D1 table and exceeds the daily write budget. ` +
          `Run "pipeline sync --bootstrap-state --run ${d1RunId}" against a local database whose newest run is ${d1RunId}, ` +
          `or pass --full to rewrite D1 deliberately.`,
      );
    }
    if (mode === "incremental" && d1RunId !== state?.runId)
      throw new Error(
        `D1 holds run ${d1RunId ?? "(none)"} but the local sync marker says ${state?.runId}; ` +
          `bootstrap the state for the D1 run ("pipeline sync --bootstrap-state --run <run>") or pass --full.`,
      );
  }
  return {
    mode,
    changedRunIds: mode === "incremental" ? changedRunIds : [opts.runId],
    ...(mode === "incremental" && state?.runId === opts.runId
      ? { alreadySyncedRun: state.runId }
      : {}),
  };
}
