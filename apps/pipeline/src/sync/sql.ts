import type { Db } from "../db/duck";
import { Batcher, Chunker, sqlLiteral } from "./batch";
import {
  bootstrapState,
  hashRow,
  loadStoredState,
  PendingWriter,
  resetPendingState,
} from "./derived-state";

export { sqlLiteral } from "./batch";
export { commitDerivedState } from "./derived-state";

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

/**
 * DuckDB select expression for a D1 column. `runs.record` gets the run's `manifest_cid`
 * merged in (publish only sets the column), so D1 consumers see `manifestCid` (null when unpublished).
 */
function selectExpr(table: D1Table, c: string): string {
  if (table === "runs" && c === "record")
    // JSON merge-patch deletes keys patched with null, so the unpublished case seeds the key instead.
    return (
      "CASE WHEN manifest_cid IS NULL THEN json_merge_patch(json_object('manifestCid', NULL), record) " +
      "ELSE json_merge_patch(record, json_object('manifestCid', manifest_cid)) END::TEXT AS record"
    );
  return TEXT_COLUMNS.has(c) ? `${c}::TEXT AS ${c}` : c;
}

export type SyncMode = "full" | "incremental";

const PK = {
  properties: ["apn"],
  permits: ["permit_number"],
  contractors: ["contractor_id"],
  owners: ["apn", "permit_number"],
  roof_age: ["apn"],
  runs: ["run_id"],
} as const satisfies Record<D1Table, readonly string[]>;

/**
 * Tables diffed by per-row hash (derived tables are rebuilt each run; permits carry computed
 * columns not covered by record_hash). `properties` uses last_changed_run + removed_keys instead.
 */
const HASHED = [
  "permits",
  "contractors",
  "owners",
  "roof_age",
] as const satisfies readonly D1Table[];
type HashedTable = (typeof HASHED)[number];
const isHashed = (t: D1Table): t is HashedTable => (HASHED as readonly string[]).includes(t);

const rowKey = (t: D1Table, r: Record<string, unknown>): string =>
  PK[t].map((c) => String(r[c])).join("|");
/**
 * Columns left out of a table's row hash. `days_open` is recomputed daily for open permits and the
 * Worker computes it at query time; for finaled permits a state change already alters
 * `permit_state`/`final_date`. Hashing it would rewrite every open permit on every sync.
 */
const UNHASHED: Partial<Record<D1Table, readonly string[]>> = { permits: ["days_open"] };
const rowHash = (t: D1Table, r: Record<string, unknown>): string =>
  hashRow(
    (D1_COLUMNS[t] as readonly string[]).filter((c) => !UNHASHED[t]?.includes(c)),
    r,
  );

/** Reads a table (optionally filtered) in key order, in pages. */
async function* readTable(
  db: Db,
  table: D1Table,
  where: string,
  batchSize: number,
): AsyncGenerator<Record<string, unknown>> {
  const select = D1_COLUMNS[table].map((c) => selectExpr(table, c)).join(", ");
  const orderBy = PK[table].join(", ");
  for (let offset = 0; ; offset += batchSize) {
    const rows = await db.all<Record<string, unknown>>(
      `SELECT ${select} FROM ${table} ${where} ORDER BY ${orderBy} LIMIT ${batchSize} OFFSET ${offset}`,
    );
    yield* rows;
    if (rows.length < batchSize) break;
  }
}

/** See `bootstrapState`: hashes the current tables as if a full sync had just completed. */
export async function bootstrapDerivedState(db: Db, batchSize = 500): Promise<number> {
  return bootstrapState(db, HASHED, async function* (t) {
    for await (const r of readTable(db, t as HashedTable, "", batchSize))
      yield { key: rowKey(t as HashedTable, r), hash: rowHash(t as HashedTable, r) };
  });
}

const inList = (ids: readonly string[]): string => ids.map(sqlLiteral).join(", ");

export type BuildOptions = {
  manifestCid: string;
  runId: string;
  /** Default "full". */
  mode?: SyncMode;
  /**
   * Incremental only: runs whose changes are pushed (default `[runId]`). Pass every run since the last
   * successful sync so a missed sync is not lost; `[]` means the run was already synced.
   */
  changedRunIds?: string[];
  batchSize?: number;
  statementsPerFile?: number;
  maxStatementBytes?: number;
  /** Filled with the number of rows written (inserted + deleted keys) per table. */
  stats?: Record<string, number>;
};

export async function* buildD1Statements(db: Db, opts: BuildOptions): AsyncGenerator<string> {
  const mode = opts.mode ?? "full";
  const batchSize = opts.batchSize ?? 500;
  const maxBytes = opts.maxStatementBytes ?? 65_536;
  const chunker = new Chunker(opts.statementsPerFile ?? 50);
  const stats = opts.stats ?? {};
  for (const t of D1_TABLES) stats[t] = 0;
  const changed = opts.changedRunIds ?? [opts.runId];
  const runList = inList(changed);

  await resetPendingState(db);
  const stored = mode === "incremental" ? await loadStoredState(db) : new Map<string, string>();

  if (mode === "full") yield `${D1_TABLES.map((t) => `DELETE FROM ${t};`).join("\n")}\n`;

  const readRows = (table: D1Table, where: string) => readTable(db, table, where, batchSize);

  const tupleOf = (table: D1Table, r: Record<string, unknown>): string =>
    `(${D1_COLUMNS[table].map((c) => sqlLiteral(r[c])).join(", ")})`;

  /** Single-column deletes use `IN (...)`; owners' composite key uses row values. */
  async function* deletes(table: D1Table, keys: string[]): AsyncGenerator<string> {
    if (keys.length === 0) return;
    const pk = PK[table];
    const composite = pk.length > 1;
    const head = composite
      ? `DELETE FROM ${table} WHERE (${pk.join(", ")}) IN (VALUES\n`
      : `DELETE FROM ${table} WHERE ${pk[0]} IN (\n`;
    const b = new Batcher(head, ");", batchSize, maxBytes);
    const out: string[] = [];
    for (const k of keys) {
      const parts = composite ? [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)] : [k];
      const tuple = composite ? `(${parts.map(sqlLiteral).join(", ")})` : sqlLiteral(k);
      const s = b.add(tuple);
      if (s) out.push(s);
    }
    const last = b.flush();
    if (last) out.push(last);
    stats[table] = (stats[table] ?? 0) + keys.length;
    for (const s of out) {
      const f = chunker.add(s);
      if (f) yield f;
    }
  }

  for (const table of D1_TABLES) {
    const cols = D1_COLUMNS[table];
    const verb = mode === "full" ? "INSERT INTO" : "INSERT OR REPLACE INTO";
    const head = `${verb} ${table} (${cols.join(", ")}) VALUES\n`;
    const batcher = new Batcher(head, ";", batchSize, maxBytes);
    const emit = function* (stmt: string | undefined): Generator<string> {
      if (!stmt) return;
      const f = chunker.add(stmt);
      if (f) yield f;
    };

    if (mode === "incremental" && table === "properties") {
      if (changed.length === 0) continue; // already-synced run: nothing new to push
      const removed = (
        await db.all<{ key: string }>(
          `SELECT DISTINCT key FROM removed_keys WHERE "table" = '${table}' AND run_id IN (${runList}) ORDER BY key`,
        )
      ).map((r) => r.key);
      yield* deletes(table, removed);
      for await (const r of readRows(table, `WHERE last_changed_run IN (${runList})`)) {
        stats[table] = (stats[table] ?? 0) + 1;
        yield* emit(batcher.add(tupleOf(table, r)));
      }
    } else if (mode === "incremental" && table === "runs") {
      const ids = new Set([...changed, opts.runId]);
      for (const r of await db.all<{ p: string | null }>(
        `SELECT previous_run_id AS p FROM runs WHERE run_id IN (${inList([...ids])})`,
      ))
        if (r.p) ids.add(r.p);
      for await (const r of readRows(table, `WHERE run_id IN (${inList([...ids])})`)) {
        stats[table] = (stats[table] ?? 0) + 1;
        yield* emit(batcher.add(tupleOf(table, r)));
      }
    } else if (isHashed(table)) {
      const t = table;
      const seen = new Set<string>();
      const pending = new PendingWriter(db, t);
      for await (const r of readRows(t, "")) {
        const key = rowKey(t, r);
        const hash = rowHash(t, r);
        seen.add(key);
        await pending.add(key, hash);
        if (mode === "incremental" && stored.get(`${t}\u0000${key}`) === hash) continue;
        stats[t] = (stats[t] ?? 0) + 1;
        yield* emit(batcher.add(tupleOf(t, r)));
      }
      await pending.flush();
      if (mode === "incremental") {
        const gone: string[] = [];
        for (const k of stored.keys()) {
          const [tt, key] = k.split("\u0000") as [string, string];
          if (tt === t && !seen.has(key)) gone.push(key);
        }
        gone.sort();
        yield* emit(batcher.flush());
        yield* deletes(t, gone);
      }
    } else {
      for await (const r of readRows(table, "")) {
        stats[table] = (stats[table] ?? 0) + 1;
        yield* emit(batcher.add(tupleOf(table, r)));
      }
    }
    yield* emit(batcher.flush());
    const f = chunker.take();
    if (f) yield f;
  }

  yield "INSERT INTO snapshot (id, run_id, manifest_cid, synced_at) VALUES " +
    `(1, ${sqlLiteral(opts.runId)}, ${sqlLiteral(opts.manifestCid)}, ${sqlLiteral(new Date().toISOString())}) ` +
    "ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, manifest_cid=excluded.manifest_cid, synced_at=excluded.synced_at;\n";
}
