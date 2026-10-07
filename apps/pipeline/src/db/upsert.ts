import type { Db } from "./duck";

export type Delta = {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
};

const COLUMNS: Record<"properties" | "permits", string[]> = {
  properties: [
    "apn",
    "situs_address",
    "situs_city",
    "situs_zip",
    "jurisdiction",
    "tax_rate_area",
    "lat",
    "lon",
    "source_key",
    "source_url",
    "source_version",
    "fetched_at",
    "page_sha256",
    "record_hash",
  ],
  permits: [
    "permit_number",
    "apn",
    "status",
    "is_roofing",
    "work_description",
    "subtype",
    "folder_name",
    "approvals",
    "issue_date",
    "final_date",
    "valuation",
    "address",
    "applicant",
    "owner_name_raw",
    "contractor_raw",
    "contractor_company",
    "contractor_contact",
    "folder_rsn",
    "source_key",
    "source_url",
    "source_version",
    "fetched_at",
    "page_sha256",
    "record_hash",
  ],
};

const STATUS_RANK =
  "CASE status WHEN 'under_inspection' THEN 3 WHEN 'active' THEN 2 WHEN 'expired' THEN 1 ELSE 0 END";

export async function upsertTable(
  db: Db,
  opts: {
    table: "properties" | "permits";
    stagingNdjsonPath: string;
    key: string;
    runId: string;
    fullSource: boolean;
  },
): Promise<Delta> {
  const { table, key, runId } = opts;
  const cols = COLUMNS[table];
  const colList = cols.join(", ");
  await db.run("DROP TABLE IF EXISTS staging_raw; DROP TABLE IF EXISTS staging");
  await db.run(
    `CREATE TEMP TABLE staging_raw AS SELECT ${colList} FROM read_json_auto('${opts.stagingNdjsonPath}', format='newline_delimited')`,
  );
  const fetched =
    (await db.all<{ n: number }>("SELECT count(*)::INT AS n FROM staging_raw"))[0]?.n ?? 0;
  const rank = table === "permits" ? STATUS_RANK : "1";
  await db.run(
    `CREATE TEMP TABLE staging AS SELECT * EXCLUDE (rn) FROM (SELECT *, row_number() OVER (PARTITION BY ${key} ORDER BY ${rank} DESC) AS rn FROM staging_raw) WHERE rn = 1`,
  );

  const count = async (sql: string) => (await db.all<{ n: number }>(sql))[0]?.n ?? 0;
  const inserted = await count(
    `SELECT count(*)::INT AS n FROM staging s LEFT JOIN ${table} t USING (${key}) WHERE t.${key} IS NULL`,
  );
  const updated = await count(
    `SELECT count(*)::INT AS n FROM staging s JOIN ${table} t USING (${key}) WHERE s.record_hash <> t.record_hash`,
  );
  const unchanged = await count(
    `SELECT count(*)::INT AS n FROM staging s JOIN ${table} t USING (${key}) WHERE s.record_hash = t.record_hash`,
  );
  let removed = 0;
  if (opts.fullSource) {
    removed = await count(
      `SELECT count(*)::INT AS n FROM ${table} t LEFT JOIN staging s USING (${key}) WHERE s.${key} IS NULL`,
    );
    await db.run(`DELETE FROM ${table} WHERE ${key} NOT IN (SELECT ${key} FROM staging)`);
  }
  const setList = cols
    .filter((c) => c !== key)
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  await db.run(
    `INSERT INTO ${table} (${colList}, first_seen_run, last_seen_run, last_changed_run)
     SELECT ${colList}, '${runId}', '${runId}', '${runId}' FROM staging
     ON CONFLICT (${key}) DO UPDATE SET ${setList},
       last_seen_run = '${runId}',
       last_changed_run = CASE WHEN ${table}.record_hash <> excluded.record_hash THEN '${runId}' ELSE ${table}.last_changed_run END`,
  );
  await db.run("DROP TABLE staging_raw; DROP TABLE staging");
  return { fetched, inserted, updated, unchanged, removed };
}
