import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "../db/duck";
import { packDirectory } from "../publish/car";
import type { Uploader } from "../publish/filebase";
import { publish } from "./publish";

const FILES = [
  "properties.parquet",
  "permits.parquet",
  "contractors.parquet",
  "owners.parquet",
  "roof_age.parquet",
  "leads.parquet",
  "runs.json",
  "coverage.json",
  "sql-examples.json",
];

async function setup() {
  const exportDir = mkdtempSync(join(tmpdir(), "pub-"));
  const docsRunsDir = join(mkdtempSync(join(tmpdir(), "docs-")), "runs");
  const dir = join(exportDir, "r2");
  mkdirSync(dir);
  for (const f of FILES) writeFileSync(join(dir, f), `content of ${f}`);
  const expected = await packDirectory(dir, FILES);
  const db = await openDb(":memory:");
  await applySchema(db);
  return { exportDir, docsRunsDir, expected, db };
}

function fakeUploader(rootCid: string, carCid = "bafkreicar", manifestCid = "bafkreimanifest") {
  const puts: Array<{ key: string; meta: Record<string, string> | undefined }> = [];
  const uploader: Uploader = {
    async putFile(key, _path, meta) {
      puts.push({ key, meta });
    },
    async headCid(key) {
      if (key.endsWith("manifest.json")) return manifestCid;
      return key.includes("/car/") ? carCid : rootCid;
    },
  };
  return { uploader, puts };
}

describe("publish", () => {
  it("uploads CAR with import, records manifest cid, links previous manifest, writes docs/runs", async () => {
    const { exportDir, docsRunsDir, expected, db } = await setup();
    await db.run(
      "INSERT INTO runs VALUES ('r1','2026-10-01 00:00:00',NULL,'2026-10-01','complete','{\"runId\":\"r1\"}','bafkreiprev',NULL)",
    );
    await db.run(
      "INSERT INTO runs VALUES ('r2','2026-10-08 00:00:00',NULL,'2026-10-08','complete','{\"runId\":\"r2\"}',NULL,'r1')",
    );
    const { uploader, puts } = fakeUploader(expected.rootCid);
    const res = await publish({
      db,
      runId: "r2",
      exportDir,
      uploader,
      docsRunsDir,
      now: "2026-10-08T02:00:00Z",
    });
    if (!("manifest" in res)) throw new Error("expected a publish");
    const { manifest } = res;
    expect(puts[0]).toMatchObject({ key: "r2/r2.car", meta: { import: "car" } });
    expect(puts.some((p) => p.key === "r2/car/r2.car" && p.meta === undefined)).toBe(true);
    expect(manifest.previousManifestCid).toBe("bafkreiprev");
    expect(manifest.car).toMatchObject({ cid: "bafkreicar", root: expected.rootCid });
    const rows = await db.all<{ manifest_cid: string | null }>(
      "SELECT manifest_cid FROM runs WHERE run_id='r2'",
    );
    expect(rows[0]?.manifest_cid).toBe("bafkreimanifest");
    const doc = JSON.parse(readFileSync(join(docsRunsDir, "r2.json"), "utf8"));
    expect(doc).toMatchObject({
      runId: "r2",
      manifestCid: "bafkreimanifest",
      manifest: { runId: "r2" },
    });
    expect(doc.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    // the DuckDB run record carries the full manifest so the D1 sync can serve it without a gateway
    const rec = await db.all<{ record: string }>(
      "SELECT record::TEXT AS record FROM runs WHERE run_id='r2'",
    );
    expect(JSON.parse(rec[0]!.record)).toEqual({ runId: "r2", manifest });
    await db.close();
  });

  it("throws on root CID mismatch and leaves manifest_cid NULL", async () => {
    const { exportDir, docsRunsDir, db } = await setup();
    await db.run(
      "INSERT INTO runs VALUES ('r2','2026-10-08 00:00:00',NULL,'2026-10-08','complete','{\"runId\":\"r2\"}',NULL,NULL)",
    );
    const { uploader } = fakeUploader("bafybeiwrong");
    await expect(
      publish({ db, runId: "r2", exportDir, uploader, docsRunsDir, now: "2026-10-08T02:00:00Z" }),
    ).rejects.toThrow(/expected/);
    const rows = await db.all<{ manifest_cid: string | null }>(
      "SELECT manifest_cid FROM runs WHERE run_id='r2'",
    );
    expect(rows[0]?.manifest_cid).toBeNull();
    expect(existsSync(join(docsRunsDir, "r2.json"))).toBe(false);
    await db.close();
  });

  it("refuses to republish a run that already has a manifest cid", async () => {
    const { exportDir, docsRunsDir, expected, db } = await setup();
    await db.run(
      "INSERT INTO runs VALUES ('r2','2026-10-08 00:00:00',NULL,'2026-10-08','complete','{}','bafkreidone',NULL)",
    );
    const { uploader, puts } = fakeUploader(expected.rootCid);
    await expect(
      publish({ db, runId: "r2", exportDir, uploader, docsRunsDir, now: "x" }),
    ).rejects.toThrow("run r2 already published as bafkreidone");
    expect(puts).toHaveLength(0);
    await db.close();
  });

  describe("unchanged runs", () => {
    const skippedRecord = JSON.stringify({
      runId: "r2",
      sources: {
        "scc-parcels": { skipped: true },
        "sj-permits-active": { skipped: true },
      },
    });

    it("skips when every source was skipped and a previous run is published", async () => {
      const { exportDir, docsRunsDir, expected, db } = await setup();
      await db.run(
        "INSERT INTO runs VALUES ('r1','2026-10-01 00:00:00',NULL,'2026-10-01','complete','{}','bafkreiprev',NULL)",
      );
      await db.run(
        `INSERT INTO runs VALUES ('r2','2026-10-08 00:00:00',NULL,'2026-10-08','complete','${skippedRecord}',NULL,'r1')`,
      );
      const { uploader, puts } = fakeUploader(expected.rootCid);
      const res = await publish({ db, runId: "r2", exportDir, uploader, docsRunsDir, now: "x" });
      expect(res).toEqual({ skipped: true, previousRunId: "r1" });
      expect(puts).toHaveLength(0);
      expect(existsSync(join(docsRunsDir, "r2.json"))).toBe(false);
      const forced = await publish({
        db,
        runId: "r2",
        exportDir,
        uploader,
        docsRunsDir,
        now: "x",
        force: true,
      });
      expect("manifest" in forced && forced.manifest.runId).toBe("r2");
      await db.close();
    });

    it("does not skip an unchanged run when an unpublished changed run sits between", async () => {
      const { exportDir, docsRunsDir, expected, db } = await setup();
      const changed = JSON.stringify({ sources: { "scc-parcels": { skipped: false } } });
      await db.run(
        "INSERT INTO runs VALUES ('r1','2026-10-01 00:00:00',NULL,'2026-10-01','complete','{}','bafkreiprev',NULL)",
      );
      await db.run(
        `INSERT INTO runs VALUES ('rA','2026-10-05 00:00:00',NULL,'2026-10-05','complete','${changed}',NULL,'r1')`,
      );
      await db.run(
        `INSERT INTO runs VALUES ('r2','2026-10-08 00:00:00',NULL,'2026-10-08','complete','${skippedRecord}',NULL,'rA')`,
      );
      const { uploader } = fakeUploader(expected.rootCid);
      const res = await publish({ db, runId: "r2", exportDir, uploader, docsRunsDir, now: "x" });
      expect("manifest" in res).toBe(true);
      await db.close();
    });

    it("publishes an unchanged run when no earlier run was published", async () => {
      const { exportDir, docsRunsDir, expected, db } = await setup();
      await db.run(
        `INSERT INTO runs VALUES ('r2','2026-10-08 00:00:00',NULL,'2026-10-08','complete','${skippedRecord}',NULL,NULL)`,
      );
      const { uploader, puts } = fakeUploader(expected.rootCid);
      const res = await publish({ db, runId: "r2", exportDir, uploader, docsRunsDir, now: "x" });
      expect("manifest" in res).toBe(true);
      expect(puts.length).toBeGreaterThan(0);
      await db.close();
    });
  });
});
