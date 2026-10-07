import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SyncMode } from "./sql";

/** Local record of the last successful D1 sync (`data/d1-sync-state.json`). */
export type SyncState = {
  runId: string;
  mode: SyncMode;
  syncedAt: string;
  rowsWritten: number;
};

const file = (dataDir: string): string => join(dataDir, "d1-sync-state.json");

export async function readSyncState(dataDir: string): Promise<SyncState | null> {
  try {
    const s = JSON.parse(await readFile(file(dataDir), "utf8")) as Partial<SyncState>;
    if (typeof s.runId !== "string" || (s.mode !== "full" && s.mode !== "incremental")) return null;
    return {
      runId: s.runId,
      mode: s.mode,
      syncedAt: String(s.syncedAt ?? ""),
      rowsWritten: Number(s.rowsWritten ?? 0),
    };
  } catch {
    return null;
  }
}

export async function writeSyncState(dataDir: string, state: SyncState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(file(dataDir), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Incremental only when D1 is known to hold an earlier snapshot AND the local derived-state table
 * can diff against it. Both the marker and the state are written only by syncs that populate them
 * (full mode does too), so syncs that predate this logic (no marker, empty state) fall back to full.
 */
export function chooseMode(
  args: { full: boolean; derivedStateRows: number; lastSyncedRunKnown: boolean },
  state: SyncState | null,
): SyncMode {
  if (args.full || !state || args.derivedStateRows === 0 || !args.lastSyncedRunKnown) return "full";
  return "incremental";
}

/** Called before a full sync: a half-finished full sync leaves D1 inconsistent, so forget the marker. */
export async function clearSyncState(dataDir: string): Promise<void> {
  await rm(file(dataDir), { force: true });
}
