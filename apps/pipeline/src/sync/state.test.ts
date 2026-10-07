import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseMode, clearSyncState, readSyncState, writeSyncState } from "./state";

const st = { runId: "r1", mode: "full", syncedAt: "t", rowsWritten: 5 } as const;
const ok = { full: false, derivedStateRows: 10, lastSyncedRunKnown: true };

describe("sync state", () => {
  it("round-trips and clears the marker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "state-"));
    expect(await readSyncState(dir)).toBeNull();
    await writeSyncState(dir, st);
    expect(await readSyncState(dir)).toEqual(st);
    await clearSyncState(dir);
    expect(await readSyncState(dir)).toBeNull();
  });

  it("chooses incremental only with marker, derived state and known last run", () => {
    expect(chooseMode(ok, st)).toBe("incremental");
    expect(chooseMode(ok, null)).toBe("full");
    expect(chooseMode({ ...ok, full: true }, st)).toBe("full");
    expect(chooseMode({ ...ok, derivedStateRows: 0 }, st)).toBe("full");
    expect(chooseMode({ ...ok, lastSyncedRunKnown: false }, st)).toBe("full");
  });
});
