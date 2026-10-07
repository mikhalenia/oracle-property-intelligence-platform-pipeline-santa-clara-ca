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
    const manifest = await publish({
      db, runId: "r2", exportDir, uploader, docsRunsDir, now: "2026-10-08T02:00:00Z",
    });
    expect(puts[0]).toMatchObject({ key: "r2/r2.car", meta: { import: "car" } });
    expect(puts.some((p) => p.key === "r2/car/r2.car" && p.meta === undefined)).toBe(true);
    expect(manifest.previousManifestCid).toBe("bafkreiprev");
    expect(manifest.car).toMatchObject({ cid: "bafkreicar", root: expected.rootCid });
    const rows = await db.all<{ manifest_cid: string | null }>("SELECT manifest_cid FROM runs WHERE run_id='r2'");
    expect(rows[0]?.manifest_cid).toBe("bafkreimanifest");
    const doc = JSON.parse(readFileSync(join(docsRunsDir, "r2.json"), "utf8"));
    expect(doc).toMatchObject({ runId: "r2", manifestCid: "bafkreimanifest", manifest: { runId: "r2" } });
    expect(doc.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
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
    const rows = await db.all<{ manifest_cid: string | null }>("SELECT manifest_cid FROM runs WHERE run_id='r2'");
    expect(rows[0]?.manifest_cid).toBeNull();
    expect(existsSync(join(docsRunsDir, "r2.json"))).toBe(false);
    await db.close();
  });
});
