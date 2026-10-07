import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "../db/duck";
import { sync } from "./sync";

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
    await db.close();
    const dir = join(outDir, "r1", "sync");
    expect(res.files).toBe(3);
    expect(res.rows["properties"]).toBe(1);
    expect(events).toEqual([
      `start ${dir}/0000.sql`,
      `end ${dir}/0000.sql`,
      `start ${dir}/0001.sql`,
      `end ${dir}/0001.sql`,
      `start ${dir}/0002.sql`,
      `end ${dir}/0002.sql`,
    ]);
  });
});
