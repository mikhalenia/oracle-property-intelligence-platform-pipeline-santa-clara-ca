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
});
