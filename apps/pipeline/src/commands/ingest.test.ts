import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "../db/duck";
import { ingest } from "./ingest";
import { fixtureFetcher } from "../test/fixture-fetcher";

const fx = (day: string) => join(__dirname, "../../fixtures", day);

describe("ingest", () => {
  it("day1 loads everything; day2 records deltas; day2 again is unchanged", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const dataDir = mkdtempSync(join(tmpdir(), "ingest-"));

    const r1 = await ingest({
      db,
      fetcher: fixtureFetcher(fx("day1")),
      dataDir,
      runId: "r1",
      asOf: "2026-10-08",
      now: "2026-10-08T01:00:00Z",
    });
    expect(r1.status).toBe("complete");
    expect(r1.sources["scc-parcels"]).toMatchObject({ inserted: 3, removed: 0, skipped: false });
    expect(r1.sources["sj-permits-active"]).toMatchObject({
      fetched: 4,
      skipped: false,
      sourceVersion: "2026-10-07T16:00:08.000000",
    });
    expect(r1.sources["sj-permits-under_inspection"]).toMatchObject({ fetched: 1, skipped: false });
    expect(r1.sources["sj-permits-expired"]).toMatchObject({ fetched: 2, skipped: false });
    // 7 CSV rows collapse to 6 permits: the under-inspection copy wins over its active twin
    expect(r1.sources["sj-permits"]).toMatchObject({
      fetched: 7,
      inserted: 6,
      updated: 0,
      unchanged: 0,
      removed: 0,
    });
    expect(
      await db.all("SELECT status FROM permits WHERE permit_number = '2026-137661-RS'"),
    ).toEqual([{ status: "under_inspection" }]);
    expect(r1.totals.roofingPermits).toBe(3);
    expect(r1.totals.roofAge).toBe(3);
    expect(r1.previousRunId).toBeNull();

    const r2 = await ingest({
      db,
      fetcher: fixtureFetcher(fx("day2")),
      dataDir,
      runId: "r2",
      asOf: "2026-10-09",
      now: "2026-10-09T01:00:00Z",
    });
    expect(r2.sources["scc-parcels"]).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 2,
      removed: 1,
    });
    expect(r2.sources["sj-permits-active"]).toMatchObject({ fetched: 5, skipped: false });
    expect(r2.sources["sj-permits-expired"]).toMatchObject({ skipped: false });
    expect(r2.sources["sj-permits"]).toMatchObject({
      inserted: 1,
      updated: 1,
      unchanged: 5,
      removed: 0,
    });
    expect(r2.totals.properties).toBe(2);
    expect(r2.previousRunId).toBe("r1");

    const r3 = await ingest({
      db,
      fetcher: fixtureFetcher(fx("day2")),
      dataDir,
      runId: "r3",
      asOf: "2026-10-10",
      now: "2026-10-10T01:00:00Z",
    });
    expect(Object.values(r3.sources).every((s) => s.skipped)).toBe(true);
    expect(r3.status).toBe("complete");
    expect(r3.previousRunId).toBe("r2");
    expect((await db.all<{ n: number }>("SELECT count(*)::INT AS n FROM runs"))[0]?.n).toBe(3);
    await db.close();
  });

  it("does not touch permits when one permit file fails", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const dataDir = mkdtempSync(join(tmpdir(), "ingest-"));
    const good = fixtureFetcher(fx("day1"));
    await ingest({
      db,
      fetcher: good,
      dataDir,
      runId: "r1",
      asOf: "2026-10-08",
      now: "2026-10-08T01:00:00Z",
    });
    const broken = fixtureFetcher(fx("day2"));
    const fetcher: typeof broken = async (url, init) =>
      url.includes("buildingpermitsexpired")
        ? new Response("nope", { status: 404 })
        : broken(url, init);
    const r2 = await ingest({
      db,
      fetcher,
      dataDir,
      runId: "r2",
      asOf: "2026-10-09",
      now: "2026-10-09T01:00:00Z",
    });
    expect(r2.status).toBe("partial");
    expect(r2.sources["sj-permits"]).toBeUndefined();
    expect(r2.totals.permits).toBe(6);
    await db.close();
  });
});
