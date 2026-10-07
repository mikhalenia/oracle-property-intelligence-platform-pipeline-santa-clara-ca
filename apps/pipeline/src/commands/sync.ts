import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db/duck";
import { allSourcesSkipped } from "./publish";
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
  const runs = await opts.db.all<{
    run_id: string;
    manifest_cid: string | null;
    record: string;
  }>("SELECT run_id, manifest_cid, record::TEXT AS record FROM runs ORDER BY started_at DESC");
  const latest = runs[0];
  if (!latest) throw new Error("no runs found; run ingest first");
  const runId = opts.runId ?? latest.run_id;
  const idx = runs.findIndex((r) => r.run_id === runId);
  const target = runs[idx];
  if (!target || !target.manifest_cid)
    throw new Error(
      `cannot bootstrap: run ${runId} must exist locally and be published (${target ? "it is unpublished" : "unknown run"})`,
    );
  // newer runs are fine only when they changed nothing, so the local tables still equal run X's
  const changedNewer = runs.slice(0, idx).filter((r) => !allSourcesSkipped(r.record));
  if (changedNewer.length > 0)
    throw new Error(
      `cannot bootstrap: run ${runId} is not current; newer run(s) ${changedNewer.map((r) => r.run_id).join(", ")} changed sources, so local tables differ from its snapshot`,
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
  const bad = (why: string, cause?: unknown): Error =>
    new Error(
      `unexpected wrangler output (${why}); cannot tell whether D1 is empty, aborting sync: ${stdout.slice(0, 200)}`,
      cause ? { cause } : undefined,
    );
  let out: unknown;
  try {
    // tolerate banner lines around the JSON array
    out = JSON.parse(stdout.slice(stdout.indexOf("["), stdout.lastIndexOf("]") + 1));
  } catch (err) {
    throw bad("not JSON", err);
  }
  const first = Array.isArray(out) ? (out[0] as { results?: unknown } | undefined) : undefined;
  if (!first || typeof first !== "object" || !Array.isArray(first.results))
    throw bad("no results array");
  const row = first.results[0] as { run_id?: unknown } | undefined;
  if (row === undefined) return null;
  if (row === null || typeof row !== "object") throw bad("malformed row");
  const runId = row.run_id;
  if (runId === undefined || runId === null) return null;
  if (typeof runId !== "string") throw bad("run_id is not a string");
  return runId;
}

/**
 * Picks the sync mode for `runId`. Incremental needs the marker from a previous successful sync, a
 * populated derived_sync_state, and a marker run that is not newer than the target. When the marker
 * run IS the target (re-sync), nothing is pushed except the runs/snapshot upserts.
 *
 * A full sync starts by deleting every D1 table and exceeds the daily write budget, so an implicit
 * full sync (no `full: true`) is REFUSED when D1 already holds a snapshot: the operator either
 * bootstraps the local state from that snapshot or passes `--full` deliberately. Incremental is
 * accepted when D1 holds the marker run or a run between the marker and the target, else refused.
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
    // D1 at the marker, or at a run between the marker and the target (a sync that pushed D1 but
    // died before writing the marker): pushing everything since the marker is idempotent
    if (
      mode === "incremental" &&
      d1RunId !== state?.runId &&
      !(d1RunId && changedRunIds.includes(d1RunId))
    )
      throw new Error(
        `D1 holds run ${d1RunId ?? "(none)"} but the local sync marker says ${state?.runId}, and it is not between the marker and ${opts.runId}; ` +
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
