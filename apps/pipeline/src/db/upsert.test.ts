import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "./duck";
import { upsertTable } from "./upsert";

const prov = {
  source_key: "sj-permits-active",
  source_url: "u",
  source_version: "v1",
  fetched_at: "2026-10-08 00:00:00",
  page_sha256: "h",
};
const permit = (over: Record<string, unknown>) => ({
  permit_number: "P1",
  apn: "27715017",
  status: "active",
  is_roofing: true,
  work_description: "ReRoof",
  subtype: null,
  folder_name: null,
  approvals: "B-Complete",
  issue_date: "2026-08-14",
  final_date: null,
  valuation: 100,
  address: "a",
  applicant: null,
  owner_name_raw: "O",
  contractor_raw: "C",
  contractor_company: "C",
  contractor_contact: null,
  folder_rsn: null,
  record_hash: "hash1",
  ...prov,
  ...over,
});

function ndjson(dir: string, name: string, rows: object[]) {
  const p = join(dir, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

describe("upsertTable", () => {
  it("inserts, then reports unchanged, updated and removed on full reloads", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const dir = mkdtempSync(join(tmpdir(), "upsert-"));

    const d1 = await upsertTable(db, {
      table: "permits",
      stagingNdjsonPath: ndjson(dir, "a.ndjson", [
        permit({}),
        permit({ permit_number: "P2", record_hash: "hash2" }),
      ]),
      key: "permit_number",
      runId: "r1",
      fullSource: true,
    });
    expect(d1).toEqual({ fetched: 2, inserted: 2, updated: 0, unchanged: 0, removed: 0 });

    const d2 = await upsertTable(db, {
      table: "permits",
      stagingNdjsonPath: ndjson(dir, "b.ndjson", [
        permit({}),
        permit({ permit_number: "P2", record_hash: "hash2" }),
      ]),
      key: "permit_number",
      runId: "r2",
      fullSource: true,
    });
    expect(d2).toEqual({ fetched: 2, inserted: 0, updated: 0, unchanged: 2, removed: 0 });

    const d3 = await upsertTable(db, {
      table: "permits",
      stagingNdjsonPath: ndjson(dir, "c.ndjson", [
        permit({ status: "under_inspection", record_hash: "hash1b" }),
        permit({ permit_number: "P3", record_hash: "hash3" }),
      ]),
      key: "permit_number",
      runId: "r3",
      fullSource: true,
    });
    expect(d3).toEqual({ fetched: 2, inserted: 1, updated: 1, unchanged: 0, removed: 1 });
    const rows = await db.all<{ permit_number: string; status: string; last_changed_run: string }>(
      "SELECT permit_number, status, last_changed_run FROM permits ORDER BY 1",
    );
    expect(rows).toEqual([
      { permit_number: "P1", status: "under_inspection", last_changed_run: "r3" },
      { permit_number: "P3", status: "active", last_changed_run: "r3" },
    ]);
    await db.close();
  });

  it("keeps the highest-precedence duplicate within one staging file", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const dir = mkdtempSync(join(tmpdir(), "upsert-"));
    await upsertTable(db, {
      table: "permits",
      stagingNdjsonPath: ndjson(dir, "a.ndjson", [
        permit({ status: "active", record_hash: "a" }),
        permit({ status: "expired", record_hash: "e" }),
        permit({ status: "under_inspection", record_hash: "u" }),
      ]),
      key: "permit_number",
      runId: "r1",
      fullSource: true,
    });
    const rows = await db.all<{ status: string }>("SELECT status FROM permits");
    expect(rows).toEqual([{ status: "under_inspection" }]);
    await db.close();
  });
});
