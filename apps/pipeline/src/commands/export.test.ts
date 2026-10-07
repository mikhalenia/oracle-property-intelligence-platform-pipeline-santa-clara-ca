import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "../db/duck";
import { exportRun } from "./export";

describe("exportRun", () => {
  it("writes parquet per table plus runs, coverage and sql examples", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    await db.run(
      "INSERT INTO runs VALUES ('r1','2026-10-08 00:00:00','2026-10-08 00:01:00','2026-10-08','complete','{\"runId\":\"r1\"}',NULL,NULL)",
    );
    const out = mkdtempSync(join(tmpdir(), "export-"));
    const res = await exportRun(db, { runId: "r1", outDir: out });
    for (const f of [
      "properties.parquet",
      "permits.parquet",
      "contractors.parquet",
      "owners.parquet",
      "roof_age.parquet",
      "leads.parquet",
      "runs.json",
      "coverage.json",
      "sql-examples.json",
    ])
      expect(existsSync(join(res.dir, f)), f).toBe(true);
    const coverage = JSON.parse(readFileSync(join(res.dir, "coverage.json"), "utf8"));
    expect(coverage).toMatchObject({
      county: "Santa Clara",
      state: "CA",
      fips: "06085",
      runId: "r1",
      tables: { properties: 0, permits: 0 },
    });
    expect(typeof coverage.generatedAt).toBe("string");
    await db.close();
  });

  it("builds leads with open-first permit, latest owner, contractor join and exclusion", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const src = "'k','http://src','v1','2026-10-08 00:00:00'";
    const trail = "'2026-10-08 00:00:00','h','h','r1','r1','r1'";
    await db.run(
      "INSERT INTO runs VALUES ('r1','2026-10-08 00:00:00',NULL,'2026-10-08','complete','{\"runId\":\"r1\"}',NULL,NULL),('r2','2026-10-09 00:00:00',NULL,'2026-10-09','complete','{\"runId\":\"r2\"}',NULL,NULL)",
    );
    await db.run(
      `INSERT INTO properties VALUES ('A1','1 Main','San Jose','95112','SAN JOSE',NULL,37.3,-121.8,'k','http://prop','pv1','2026-10-08 00:00:00','h','h','r1','r1','r1'),('B2','2 Main','San Jose','95112','SAN JOSE',NULL,37.3,-121.8,'k','http://prop2','pv1','2026-10-08 00:00:00','h','h','r1','r1','r1')`,
    );
    const permit = (n: string, apn: string, state: string, roofing: boolean, issue: string, cid: string) =>
      `('${n}','${apn}','s','${state}',${roofing},'work',NULL,NULL,NULL,'${issue}',NULL,10,NULL,NULL,NULL,NULL,NULL,'ACME Roofing',NULL,'${cid}',NULL,'k','http://permit/${n}','pv-${n}',${trail})`;
    await db.run(
      `INSERT INTO permits VALUES ${[
        permit("P-OLD-OPEN", "A1", "open", true, "2020-01-01", "c1"),
        permit("P-NEW-FINAL", "A1", "finaled", true, "2024-01-01", "c2"),
        permit("P-NONROOF", "A1", "open", false, "2025-01-01", "c3"),
        permit("P-B-NONROOF", "B2", "open", false, "2025-01-01", "c3"),
      ].join(",")}`,
    );
    await db.run(
      `INSERT INTO contractors VALUES ('c1','ACME Roofing',NULL,2,2,'LIC123','active','exact','A+',${src})`,
    );
    await db.run(`INSERT INTO roof_age VALUES ('A1','2020-01-01',6,'permit','high','P-OLD-OPEN',${src})`);
    await db.run(
      `INSERT INTO owners VALUES ('A1','OLD OWNER','2021-05-01','P-OLD-OPEN',${src}),('A1','NEW OWNER','2023-05-01','P-NEW-FINAL',${src}),('A1','UNDATED OWNER',NULL,'P-NONROOF',${src})`,
    );
    const out = mkdtempSync(join(tmpdir(), "export-"));
    const res = await exportRun(db, { runId: "r2", outDir: out });
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM read_parquet('${join(res.dir, "leads.parquet")}')`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      apn: "A1",
      permit_number: "P-OLD-OPEN",
      permit_state: "open",
      owner_name: "NEW OWNER",
      cslb_license_number: "LIC123",
      contractor_company: "ACME Roofing",
      roof_age_permit: "P-OLD-OPEN",
      property_source_url: "http://prop",
      permit_source_url: "http://permit/P-OLD-OPEN",
    });
    const runs = JSON.parse(readFileSync(join(res.dir, "runs.json"), "utf8"));
    expect(runs.map((r: { runId: string }) => r.runId)).toEqual(["r2", "r1"]);
    await db.close();
  });
});
