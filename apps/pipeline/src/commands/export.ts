import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sqlString, type Db } from "../db/duck";
import { SQL_EXAMPLES } from "../sql-examples";

const TABLES = ["properties", "permits", "contractors", "owners", "roof_age"] as const;

const leadsSql = (asOf: string): string => `
  SELECT p.apn, p.situs_address, p.situs_city, p.situs_zip, p.jurisdiction, p.lat, p.lon,
         r.roof_date, r.roof_age_years, r.anchor AS roof_age_anchor, r.confidence AS roof_age_confidence, r.permit_number AS roof_age_permit,
         lp.permit_number, lp.permit_state,
         CASE WHEN lp.permit_state = 'finaled' THEN lp.days_open ELSE date_diff('day', lp.issue_date, DATE '${sqlString(asOf)}')::INTEGER END AS days_open, lp.issue_date, lp.final_date, lp.work_description, lp.contractor_company, lp.contractor_id,
         c.cslb_license_number, c.cslb_status, c.bbb_rating,
         o.owner_name, o.observed_on AS owner_observed_on,
         p.source_url AS property_source_url, p.source_version AS property_source_version, p.fetched_at AS property_fetched_at,
         lp.source_url AS permit_source_url, lp.source_version AS permit_source_version
  FROM properties p
  LEFT JOIN roof_age r USING (apn)
  LEFT JOIN (SELECT * FROM permits WHERE is_roofing QUALIFY row_number() OVER (PARTITION BY apn ORDER BY (permit_state='open') DESC, issue_date DESC, permit_number) = 1) lp USING (apn)
  LEFT JOIN contractors c ON c.contractor_id = lp.contractor_id
  LEFT JOIN (SELECT * FROM owners QUALIFY row_number() OVER (PARTITION BY apn ORDER BY observed_on DESC NULLS LAST) = 1) o USING (apn)
  WHERE r.apn IS NOT NULL OR lp.permit_number IS NOT NULL`;

const copyParquet = (db: Db, select: string, path: string) =>
  db.run(`COPY (${select}) TO '${sqlString(path)}' (FORMAT PARQUET, COMPRESSION ZSTD)`);

export async function exportRun(
  db: Db,
  opts: { runId: string; outDir: string; asOf?: string },
): Promise<{ dir: string; files: string[] }> {
  const dir = join(opts.outDir, opts.runId);
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  // days_open is stored only for finaled permits; open/expired ones are measured to the run's as_of.
  const asOf =
    opts.asOf ??
    (
      await db.all<{ as_of: string }>("SELECT as_of::TEXT AS as_of FROM runs WHERE run_id = ?", [
        opts.runId,
      ])
    )[0]?.as_of;
  if (!asOf) throw new Error(`run ${opts.runId} not found; cannot compute days_open`);
  for (const t of TABLES) {
    await copyParquet(db, `SELECT * FROM ${t}`, join(dir, `${t}.parquet`));
    files.push(`${t}.parquet`);
  }
  await copyParquet(db, leadsSql(asOf), join(dir, "leads.parquet"));
  files.push("leads.parquet");

  const runs = await db.all<{ record: string }>("SELECT record FROM runs ORDER BY started_at DESC");
  await writeFile(
    join(dir, "runs.json"),
    JSON.stringify(
      runs.map((r) => JSON.parse(r.record)),
      null,
      2,
    ),
  );

  const counts: Record<string, number> = {};
  for (const t of [...TABLES, "runs"])
    counts[t] = (await db.all<{ n: number }>(`SELECT count(*)::INT n FROM ${t}`))[0]?.n ?? 0;
  const permitRange = (
    await db.all<{ min: string | null; max: string | null }>(
      "SELECT min(issue_date)::TEXT AS min, max(issue_date)::TEXT AS max FROM permits",
    )
  )[0];
  const jurisdictions = await db.all<{ jurisdiction: string; n: number }>(
    "SELECT jurisdiction, count(*)::INT n FROM properties GROUP BY 1 ORDER BY 2 DESC",
  );
  await writeFile(
    join(dir, "coverage.json"),
    JSON.stringify(
      {
        county: "Santa Clara",
        state: "CA",
        fips: "06085",
        runId: opts.runId,
        generatedAt: new Date().toISOString(),
        tables: counts,
        permitIssueDateRange: permitRange,
        permitJurisdictions: ["SAN JOSE"],
        parcelJurisdictions: jurisdictions,
      },
      null,
      2,
    ),
  );
  await writeFile(join(dir, "sql-examples.json"), JSON.stringify(SQL_EXAMPLES, null, 2));
  files.push("runs.json", "coverage.json", "sql-examples.json");
  return { dir, files };
}
