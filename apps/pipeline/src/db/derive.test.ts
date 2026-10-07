import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "./duck";
import { deriveAll } from "./derive";

describe("deriveAll", () => {
  it("computes permit_state/days_open, roof_age, contractors, owners", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const prov = "'sj-permits-active','u','v','2026-10-08 00:00:00','h'";
    await db.run(`INSERT INTO permits (permit_number, apn, status, is_roofing, approvals, issue_date, final_date, owner_name_raw, contractor_company, contractor_contact, source_key, source_url, source_version, fetched_at, page_sha256, record_hash, first_seen_run, last_seen_run, last_changed_run) VALUES
      ('P1','27715017','active',true,'B-Complete','2026-08-14',NULL,'ALICE','PEACH ROOFING SOLUTIONS INC','Jason',${prov},'x','r1','r1','r1'),
      ('P2','27715017','expired',true,'B-Complete','2009-05-01','2009-06-01','BOB','Peach Roofing Solutions, Inc.',NULL,${prov},'y','r1','r1','r1'),
      ('P3','11111111','expired',false,'',  '2015-01-01',NULL,NULL,'OTHER CO',NULL,${prov},'z','r1','r1','r1')`);
    const stats = await deriveAll(db, "2026-10-08");
    expect(stats).toEqual({ roofAgeRows: 1, contractors: 2, owners: 2 });
    const p = await db.all<{
      permit_number: string;
      permit_state: string;
      days_open: number;
      contractor_id: string | null;
    }>("SELECT permit_number, permit_state, days_open, contractor_id FROM permits ORDER BY 1");
    expect(p.map((r) => r.permit_state)).toEqual(["open", "finaled", "expired_unfinaled"]);
    expect(p[0]?.days_open).toBeNull(); // open: computed at query time
    expect(p[1]?.days_open).toBe(31); // finaled: issue to final
    expect(p[2]?.days_open).toBeNull();
    expect(p[0]?.contractor_id).toBe(p[1]?.contractor_id);
    const roof = await db.all<{ apn: string; roof_age_years: number; anchor: string }>(
      "SELECT apn, roof_age_years, anchor FROM roof_age",
    );
    expect(roof).toEqual([
      { apn: "27715017", roof_age_years: 0, anchor: "approval_complete_issue_date" },
    ]);
    const c = await db.all<{ company_name: string; roofing_permit_count: number }>(
      "SELECT company_name, roofing_permit_count FROM contractors ORDER BY 2 DESC",
    );
    expect(c[0]?.roofing_permit_count).toBe(2);
    await db.close();
  });

  it("days_open is stored only for finaled permits, and empty tables derive cleanly", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    expect(await deriveAll(db, "2026-10-08")).toEqual({
      roofAgeRows: 0,
      contractors: 0,
      owners: 0,
    });
    const prov = "'sj-permits-active','u','v','2026-10-08 00:00:00','h'";
    await db.run(
      `INSERT INTO permits (permit_number, apn, status, is_roofing, issue_date, final_date, source_key, source_url, source_version, fetched_at, page_sha256, record_hash, first_seen_run, last_seen_run, last_changed_run) VALUES ('P1','27715017','active',false,'2026-08-14',NULL,${prov},'x','r1','r1','r1'),
       ('P2','27715018','expired',false,'2026-08-14','2026-09-01',${prov},'y','r1','r1','r1')`,
    );
    await deriveAll(db, "2026-10-08");
    const q = "SELECT days_open FROM permits ORDER BY permit_number";
    const a = await db.all<{ days_open: number | null }>(q);
    await deriveAll(db, "2026-10-18");
    const b = await db.all<{ days_open: number | null }>(q);
    expect(a).toEqual([{ days_open: null }, { days_open: 18 }]);
    expect(b).toEqual(a);
    await db.close();
  });
});
