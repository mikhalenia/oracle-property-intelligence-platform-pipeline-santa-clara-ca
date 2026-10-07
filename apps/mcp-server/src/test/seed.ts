/** Fixed fixture snapshot: center (37.33, -121.88); A and B within 1 mile, C ~20 miles north. */
export const CENTER = { lat: 37.33, lon: -121.88 };

const PARCELS_URL = "https://data.sccgov.org/parcels";
export const MANIFEST = { schema: "scc-manifest/1", tables: [] };
export const MANIFEST_URL = "https://ipfs.filebase.io/ipfs/bafy-manifest";

const PERMITS_URL = "https://data.sanjoseca.gov/permits";

/** Fixed "now" for days-open assertions; the open fixture permit was issued 1,096 days earlier. */
export const AS_OF = "2026-10-07";
/** Far from CENTER so the days-open fixtures never join the other tests' results. */
export const DAYS_CENTER = { lat: 37.9, lon: -121.5 };

export async function seed(db: D1Database): Promise<void> {
  const prop = db.prepare(
    `INSERT INTO properties (apn, situs_address, situs_city, situs_zip, jurisdiction, lat, lon, source_url, source_version, fetched_at)
     VALUES (?1, ?2, 'SAN JOSE', '95112', 'San Jose', ?3, ?4, '${PARCELS_URL}', 'v-parcels', '2026-10-07T17:00:00Z')`,
  );
  const permit = db.prepare(
    `INSERT INTO permits (permit_number, apn, status, permit_state, is_roofing, work_description, subtype, approvals,
       issue_date, final_date, days_open, valuation, address, contractor_company, contractor_id, source_url, source_version, fetched_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, 'RES', 'Roofing', ?6, ?7, ?8, 12000, ?9, 'ACME ROOFING INC', 'acme-roofing', '${PERMITS_URL}', 'v-permits', '2026-10-07T16:00:00Z')`,
  );
  await db.batch([
    prop.bind("A-001", "100 MAIN ST", 37.335, -121.885),
    prop.bind("B-002", "200 MAIN ST", 37.34, -121.88),
    prop.bind("C-003", "300 FAR AWAY RD", 37.62, -121.88),
    permit.bind(
      "2023-001-RF",
      "A-001",
      "Active",
      "open",
      "Reroof",
      "2023-10-07",
      null,
      null,
      "100 MAIN ST",
    ),
    permit.bind(
      "2006-002-RF",
      "B-002",
      "Finaled",
      "finaled",
      "Reroof comp shingle",
      "2006-05-01",
      "2006-06-15",
      null,
      "200 MAIN ST",
    ),
    // Days-open fixtures: open (issued 1,095 days before AS_OF, days_open NULL), finaled (stored 60),
    // and no issue_date.
    ...[
      ["D-004", "D-PERMIT-OPEN", "open", "2023-10-08", null, null],
      ["E-005", "D-PERMIT-FINALED", "finaled", "2020-01-01", "2020-03-01", 60],
      ["F-006", "D-PERMIT-NOISSUE", "open", null, null, null],
    ].flatMap(([apn, num, state, issue, fin, days], i) => [
      prop.bind(apn, `${i + 1} DAYS ST`, DAYS_CENTER.lat + i * 0.001, DAYS_CENTER.lon),
      db
        .prepare(
          `INSERT INTO permits (permit_number, apn, status, permit_state, is_roofing, issue_date, final_date, days_open, source_url, source_version, fetched_at)
           VALUES (?1, ?2, 'x', ?3, 1, ?4, ?5, ?6, '${PERMITS_URL}', 'v-permits', '2026-10-07T16:00:00Z')`,
        )
        .bind(num, apn, state, issue, fin, days),
    ]),
    db.prepare(
      `INSERT INTO roof_age (apn, roof_date, roof_age_years, anchor, confidence, permit_number, source_url, source_version, fetched_at)
       VALUES ('B-002', '2006-06-15', 20, 'final_date', 'high', '2006-002-RF', '${PERMITS_URL}', 'v-permits', '2026-10-07T16:00:00Z')`,
    ),
    db.prepare(
      `INSERT INTO contractors (contractor_id, company_name, contact_name, permit_count, roofing_permit_count,
         cslb_license_number, cslb_status, cslb_match_method, bbb_rating, source_url, source_version, fetched_at)
       VALUES ('acme-roofing', 'ACME ROOFING INC', 'Jane Doe', 2, 2, '123456', 'Active', 'name', NULL, '${PERMITS_URL}', 'v-permits', '2026-10-07T16:00:00Z')`,
    ),
    db.prepare(
      `INSERT INTO owners (apn, owner_name, observed_on, permit_number, source_url, source_version, fetched_at)
       VALUES ('A-001', 'SMITH JOHN', '2023-10-07', '2023-001-RF', '${PERMITS_URL}', 'v-permits', '2026-10-07T16:00:00Z')`,
    ),
    db.prepare(
      `INSERT INTO snapshot (id, run_id, manifest_cid, synced_at) VALUES (1, 'run-2', 'bafy-manifest', '2026-10-07T18:00:00Z')`,
    ),
    // Records as synced from DuckDB: `manifestCid` merged in (null when unpublished).
    // run-3 is newer but unpublished; the snapshot points at run-2.
    ...[
      { runId: "run-1", manifestCid: "bafy-old" },
      { runId: "run-2", manifestCid: "bafy-manifest" },
      { runId: "run-3", manifestCid: null },
    ].map((r) =>
      db
        .prepare(`INSERT INTO runs (run_id, record) VALUES (?1, ?2)`)
        .bind(r.runId, JSON.stringify(r)),
    ),
  ]);
}
