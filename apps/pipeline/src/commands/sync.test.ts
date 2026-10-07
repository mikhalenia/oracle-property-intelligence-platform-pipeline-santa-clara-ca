import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "../db/duck";
import { chooseMode, readSyncState, writeSyncState } from "../sync/state";
import { bootstrapSyncState, parseD1SnapshotRunId, planSync, sync } from "./sync";

describe("sync", () => {
  it("writes numbered files and execs them sequentially", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    await db.run(
      "INSERT INTO properties VALUES ('A1','x','y','z','j','t',1,2,'k','u','v','2026-10-01 00:00:00','h','h','r','r','r')",
    );
    const outDir = mkdtempSync(join(tmpdir(), "sync-"));
    const events: string[] = [];
    let inFlight = 0;
    const res = await sync({
      db,
      runId: "r1",
      manifestCid: "cid",
      outDir,
      exec: async (file) => {
        inFlight++;
        expect(inFlight).toBe(1);
        events.push(`start ${file}`);
        expect(readFileSync(file, "utf8").length).toBeGreaterThan(0);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`end ${file}`);
        inFlight--;
      },
    });
    const dir = join(outDir, "r1", "sync");
    expect(res.files).toBe(3);
    expect(res.mode).toBe("full");
    expect(
      (await db.all<{ n: number }>("SELECT count(*)::INT AS n FROM derived_sync_state"))[0]!.n,
    ).toBe(0);
    expect(res.rows["properties"]).toBe(1);
    expect(events).toEqual([
      `start ${dir}/0000.sql`,
      `end ${dir}/0000.sql`,
      `start ${dir}/0001.sql`,
      `end ${dir}/0001.sql`,
      `start ${dir}/0002.sql`,
      `end ${dir}/0002.sql`,
    ]);
    await db.close();
  });

  it("bootstraps local state without touching D1, then chooses incremental", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    await db.run(
      "INSERT INTO properties VALUES ('A1','x','y','z','j','t',1,2,'k','u','v','2026-10-01 00:00:00','h','h','r','r','r')",
    );
    await db.run(
      "INSERT INTO roof_age VALUES ('A1','2020-05-01',6,'issue','high','P1','k','u','v','2026-10-01 00:00:00')",
    );
    await db.run(
      "INSERT INTO runs VALUES ('r1','2026-10-01 00:00:00',NULL,'2026-10-01','complete','{}','cid',NULL)",
    );
    const dataDir = mkdtempSync(join(tmpdir(), "boot-"));
    await expect(bootstrapSyncState({ db, dataDir, runId: "other" })).rejects.toThrow(
      /cannot bootstrap/,
    );
    expect(await readSyncState(dataDir)).toBeNull();
    const res = await bootstrapSyncState({ db, dataDir, runId: "r1" });
    expect(res).toEqual({ runId: "r1", stateRows: 1 });
    const state = await readSyncState(dataDir);
    expect(state).toMatchObject({ runId: "r1", mode: "full", rowsWritten: 0, bootstrapped: true });
    expect(chooseMode({ full: false, derivedStateRows: 1, lastSyncedRunKnown: true }, state)).toBe(
      "incremental",
    );
    await db.close();
  });

  describe("planSync", () => {
    const d1 = (runId: string | null) => async () => runId;
    async function setup(marker: string | null) {
      const db = await openDb(":memory:");
      await applySchema(db);
      await db.run(
        `INSERT INTO runs VALUES ('r1','2026-10-01 00:00:00',NULL,'2026-10-01','complete','{"runId":"r1"}','c1',NULL),
         ('r2','2026-10-02 00:00:00',NULL,'2026-10-02','complete','{"runId":"r2"}','c2','r1'),
         ('r3','2026-10-03 00:00:00',NULL,'2026-10-03','complete','{"runId":"r3"}','c3','r2')`,
      );
      await db.run("INSERT INTO derived_sync_state VALUES ('roof_age','A1','h')");
      const dataDir = mkdtempSync(join(tmpdir(), "plan-"));
      if (marker)
        await writeSyncState(dataDir, {
          runId: marker,
          mode: "full",
          syncedAt: "t",
          rowsWritten: 0,
        });
      return { db, dataDir };
    }

    it("re-sync of the synced run is incremental and writes no table rows", async () => {
      const { db, dataDir } = await setup("r2");
      await db.run(
        "INSERT INTO properties VALUES ('A1','x','y','z','j','t',1,2,'k','u','v','2026-10-01 00:00:00','h','h','r2','r2','r2')",
      );
      const plan = await planSync({
        db,
        dataDir,
        runId: "r2",
        full: false,
        d1SnapshotRunId: d1("r2"),
      });
      expect(plan).toEqual({ mode: "incremental", changedRunIds: [], alreadySyncedRun: "r2" });
      const res = await sync({
        db,
        runId: "r2",
        manifestCid: "c2",
        outDir: mkdtempSync(join(tmpdir(), "o-")),
        exec: async () => {},
        mode: plan.mode,
        changedRunIds: plan.changedRunIds,
      });
      expect(res.rows).toMatchObject({
        properties: 0,
        permits: 0,
        contractors: 0,
        owners: 0,
        runs: 2,
      });
      expect(await readSyncState(dataDir)).not.toBeNull();
      await db.close();
    });

    it("older marker is incremental over the runs since", async () => {
      const { db, dataDir } = await setup("r1");
      expect(
        await planSync({ db, dataDir, runId: "r3", full: false, d1SnapshotRunId: d1("r1") }),
      ).toEqual({
        mode: "incremental",
        changedRunIds: ["r2", "r3"],
      });
      await db.close();
    });

    it("no marker and an empty D1 is full; --full is full even when D1 holds a snapshot", async () => {
      const a = await setup(null);
      expect(
        (await planSync({ ...a, runId: "r2", full: false, d1SnapshotRunId: d1(null) })).mode,
      ).toBe("full");
      const b = await setup("r1");
      expect(
        (await planSync({ ...b, runId: "r2", full: true, d1SnapshotRunId: d1("r1") })).mode,
      ).toBe("full");
      await a.db.close();
      await b.db.close();
    });

    it("refuses an implicit full sync when D1 already holds a snapshot and names the bootstrap command", async () => {
      const a = await setup(null);
      await expect(
        planSync({ ...a, runId: "r2", full: false, d1SnapshotRunId: d1("r1") }),
      ).rejects.toThrow("sync --bootstrap-state --run r1");
      // empty derived state with a marker would also fall back to full: refused too
      const b = await setup("r1");
      await b.db.run("DELETE FROM derived_sync_state");
      await expect(
        planSync({ ...b, runId: "r2", full: false, d1SnapshotRunId: d1("r1") }),
      ).rejects.toThrow(/refusing a full D1 sync/);
      await a.db.close();
      await b.db.close();
    });

    it("refuses incremental when D1 holds a different run than the local marker", async () => {
      const { db, dataDir } = await setup("r1");
      await expect(
        planSync({ db, dataDir, runId: "r3", full: false, d1SnapshotRunId: d1("r2") }),
      ).rejects.toThrow(/D1 holds run r2 but the local sync marker says r1/);
      await db.close();
    });
  });

  describe("parseD1SnapshotRunId", () => {
    it("reads the run id from wrangler --json output", () => {
      expect(parseD1SnapshotRunId('[{"results":[{"run_id":"r9"}],"success":true,"meta":{}}]')).toBe(
        "r9",
      );
      expect(parseD1SnapshotRunId('banner\n[{"results":[{"run_id":"r8"}]}]\n')).toBe("r8");
      expect(parseD1SnapshotRunId('[{"results":[],"success":true,"meta":{}}]')).toBeNull();
      expect(() => parseD1SnapshotRunId("not json")).toThrow(/unexpected wrangler output/);
    });
  });
});
