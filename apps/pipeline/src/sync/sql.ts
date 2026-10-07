import type { Db } from "../db/duck";

/** D1 column order per table; must match apps/mcp-server/migrations/0001_snapshot.sql. */
export const D1_COLUMNS = {
  properties: [
    "apn",
    "situs_address",
    "situs_city",
    "situs_zip",
    "jurisdiction",
    "lat",
    "lon",
    "source_url",
    "source_version",
    "fetched_at",
  ],
  permits: [
    "permit_number",
    "apn",
    "status",
    "permit_state",
    "is_roofing",
    "work_description",
    "subtype",
    "folder_name",
    "approvals",
    "issue_date",
    "final_date",
    "days_open",
    "valuation",
    "address",
    "applicant",
    "owner_name_raw",
    "contractor_company",
    "contractor_contact",
    "contractor_id",
    "source_url",
    "source_version",
    "fetched_at",
  ],
  contractors: [
    "contractor_id",
    "company_name",
    "contact_name",
    "permit_count",
    "roofing_permit_count",
    "cslb_license_number",
    "cslb_status",
    "cslb_match_method",
    "bbb_rating",
    "source_url",
    "source_version",
    "fetched_at",
  ],
  owners: [
    "apn",
    "owner_name",
    "observed_on",
    "permit_number",
    "source_url",
    "source_version",
    "fetched_at",
  ],
  roof_age: [
    "apn",
    "roof_date",
    "roof_age_years",
    "anchor",
    "confidence",
    "permit_number",
    "source_url",
    "source_version",
    "fetched_at",
  ],
  runs: ["run_id", "record"],
} as const satisfies Record<string, readonly string[]>;

export type D1Table = keyof typeof D1_COLUMNS;
export const D1_TABLES = Object.keys(D1_COLUMNS) as D1Table[];

/** Columns read as text from DuckDB (dates, timestamps, JSON). */
const TEXT_COLUMNS = new Set([
  "fetched_at",
  "issue_date",
  "final_date",
  "observed_on",
  "roof_date",
  "record",
]);

export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

export async function* buildD1Statements(
  db: Db,
  opts: { manifestCid: string; runId: string; batchSize?: number; statementsPerFile?: number },
): AsyncGenerator<string> {
  const batchSize = opts.batchSize ?? 500;
  const statementsPerFile = opts.statementsPerFile ?? 50;
  yield `${D1_TABLES.map((t) => `DELETE FROM ${t};`).join("\n")}\n`;

  for (const table of D1_TABLES) {
    const cols = D1_COLUMNS[table];
    const select = cols.map((c) => (TEXT_COLUMNS.has(c) ? `${c}::TEXT AS ${c}` : c)).join(", ");
    const orderBy = table === "owners" ? "apn, permit_number" : cols[0];
    let pending: string[] = [];
    for (let offset = 0; ; offset += batchSize) {
      const rows = await db.all<Record<string, unknown>>(
        `SELECT ${select} FROM ${table} ORDER BY ${orderBy} LIMIT ${batchSize} OFFSET ${offset}`,
      );
      if (rows.length === 0) break;
      const values = rows.map((r) => `(${cols.map((c) => sqlLiteral(r[c])).join(", ")})`);
      pending.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES\n${values.join(",\n")};`);
      if (pending.length >= statementsPerFile) {
        yield `${pending.join("\n")}\n`;
        pending = [];
      }
      if (rows.length < batchSize) break;
    }
    if (pending.length > 0) yield `${pending.join("\n")}\n`;
  }

  yield "INSERT INTO snapshot (id, run_id, manifest_cid, synced_at) VALUES " +
    `(1, ${sqlLiteral(opts.runId)}, ${sqlLiteral(opts.manifestCid)}, ${sqlLiteral(new Date().toISOString())}) ` +
    "ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, manifest_cid=excluded.manifest_cid, synced_at=excluded.synced_at;\n";
}
