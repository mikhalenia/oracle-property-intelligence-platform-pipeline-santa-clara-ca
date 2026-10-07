import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "./duck";

describe("duck", () => {
  it("opens in-memory db, applies schema, round-trips a row", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    await db.run("INSERT INTO runs VALUES (?, ?, NULL, ?, 'complete', '{}', NULL, NULL)", [
      "r1",
      "2026-10-08 00:00:00",
      "2026-10-08",
    ]);
    const rows = await db.all<{ run_id: string }>("SELECT run_id FROM runs");
    expect(rows).toEqual([{ run_id: "r1" }]);
    await db.close();
  });
});
