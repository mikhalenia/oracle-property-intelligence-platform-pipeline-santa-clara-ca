import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contractorId, daysOpen, derivePermitState, deriveRoofAge } from "@scc/domain";
import { sqlString, withTransaction, type Db } from "./duck";

type PermitLite = {
  permit_number: string;
  apn: string | null;
  status: "active" | "under_inspection" | "expired";
  is_roofing: boolean;
  approvals: string | null;
  issue_date: string | null;
  final_date: string | null;
  owner_name_raw: string | null;
  contractor_company: string | null;
  contractor_contact: string | null;
  source_key: string;
  source_url: string;
  source_version: string;
  fetched_at: string;
};

export async function deriveAll(
  db: Db,
  asOf: string,
): Promise<{ roofAgeRows: number; contractors: number; owners: number }> {
  const permits = await db.all<PermitLite>(
    "SELECT permit_number, apn, status, is_roofing, approvals, issue_date::TEXT AS issue_date, final_date::TEXT AS final_date, owner_name_raw, contractor_company, contractor_contact, source_key, source_url, source_version, fetched_at::TEXT AS fetched_at FROM permits",
  );

  // 1. permit_state, days_open, contractor_id — batched UPDATE via a temp table
  const updates = permits.map((p) => {
    const state = derivePermitState({ status: p.status, finalDate: p.final_date });
    return {
      permit_number: p.permit_number,
      permit_state: state,
      // Stored only for finaled permits (issue to final: stable). Open/expired values would change
      // daily and force daily D1 rewrites; the Worker computes those at query time.
      days_open:
        state === "finaled"
          ? daysOpen({ state, issueDate: p.issue_date, finalDate: p.final_date, asOf })
          : null,
      contractor_id: p.contractor_company ? contractorId(p.contractor_company) : null,
    };
  });
  await withTransaction(db, async () => {
    await loadTemp(db, "permit_updates", updates);
    await db.run(
      "UPDATE permits SET permit_state = u.permit_state, days_open = u.days_open, contractor_id = u.contractor_id FROM permit_updates u WHERE permits.permit_number = u.permit_number",
    );

    // 2. roof_age — newest evidence per APN
    const best = new Map<
      string,
      { row: PermitLite; roof: NonNullable<ReturnType<typeof deriveRoofAge>> }
    >();
    for (const p of permits) {
      if (!p.apn) continue;
      const roof = deriveRoofAge({
        isRoofing: p.is_roofing,
        approvals: p.approvals,
        issueDate: p.issue_date,
        finalDate: p.final_date,
        asOf,
      });
      if (!roof) continue;
      const prev = best.get(p.apn);
      if (!prev || roof.roofDate > prev.roof.roofDate) best.set(p.apn, { row: p, roof });
    }
    await db.run("DELETE FROM roof_age");
    await loadTemp(
      db,
      "roof_rows",
      [...best.entries()].map(([apn, { row, roof }]) => ({
        apn,
        roof_date: roof.roofDate,
        roof_age_years: roof.roofAgeYears,
        anchor: roof.anchor,
        confidence: roof.confidence,
        permit_number: row.permit_number,
        source_key: row.source_key,
        source_url: row.source_url,
        source_version: row.source_version,
        fetched_at: row.fetched_at,
      })),
    );
    await db.run("INSERT INTO roof_age SELECT * FROM roof_rows");

    // 3. contractors — aggregate by contractor_id
    await db.run("DELETE FROM contractors");
    await db.run(`INSERT INTO contractors
    SELECT contractor_id, arg_max(contractor_company, fetched_at), arg_max(contractor_contact, fetched_at), count(*)::INT, sum(CASE WHEN is_roofing THEN 1 ELSE 0 END)::INT,
           NULL, NULL, NULL, NULL, 'sj-permits', 'https://data.sanjoseca.gov/dataset/active-building-permits', max(source_version), max(fetched_at)
    FROM permits WHERE contractor_id IS NOT NULL GROUP BY contractor_id`);

    // 4. owners — one observation per (apn, permit)
    await db.run("DELETE FROM owners");
    await db.run(
      "INSERT INTO owners SELECT apn, owner_name_raw, issue_date, permit_number, source_key, source_url, source_version, fetched_at FROM permits WHERE apn IS NOT NULL AND owner_name_raw IS NOT NULL",
    );
  });

  const n = async (t: string) =>
    (await db.all<{ n: number }>(`SELECT count(*)::INT AS n FROM ${t}`))[0]?.n ?? 0;
  return {
    roofAgeRows: await n("roof_age"),
    contractors: await n("contractors"),
    owners: await n("owners"),
  };
}

const EMPTY_TEMP: Record<string, string> = {
  permit_updates:
    "CREATE TEMP TABLE permit_updates (permit_number TEXT, permit_state TEXT, days_open INTEGER, contractor_id TEXT)",
  roof_rows: "CREATE TEMP TABLE roof_rows AS SELECT * FROM roof_age WHERE false",
};

async function loadTemp(db: Db, name: string, rows: object[]): Promise<void> {
  await db.run(`DROP TABLE IF EXISTS ${name}`);
  if (rows.length === 0) {
    const ddl = EMPTY_TEMP[name];
    if (!ddl) throw new Error(`no empty schema for temp table ${name}`);
    await db.run(ddl);
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "scc-"));
  const path = join(dir, `${name}.ndjson`);
  await writeFile(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await db.run(
    `CREATE TEMP TABLE ${name} AS SELECT * FROM read_json_auto('${sqlString(path)}', format='newline_delimited')`,
  );
}
