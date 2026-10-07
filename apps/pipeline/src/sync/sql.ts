import { createHash } from "node:crypto";
import { withTransaction, type Db } from "../db/duck";

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

export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
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

const DERIVED = ["contractors", "owners", "roof_age"] as const satisfies readonly D1Table[];
type DerivedTable = (typeof DERIVED)[number];

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Groups tuples into size-bound statements and statements into files. */
class Chunker {
  private pending: string[] = [];
  constructor(private readonly perFile: number) {}
  /** Adds a statement; returns a file body when enough statements have accumulated. */
  add(stmt: string): string | undefined {
    this.pending.push(stmt);
    return this.pending.length >= this.perFile ? this.take() : undefined;
  }
  take(): string | undefined {
    if (this.pending.length === 0) return undefined;
    const out = `${this.pending.join("\n")}\n`;
    this.pending = [];
    return out;
  }
}

/** Accumulates tuples under `head`/`tail`, emitting a statement when the size or row bound is hit. */
class Batcher {
  private tuples: string[] = [];
  private size: number;
  constructor(
    private readonly head: string,
    private readonly tail: string,
    private readonly maxRows: number,
    private readonly maxBytes: number,
  ) {
    this.size = head.length + 1;
  }
  add(tuple: string): string | undefined {
    let out: string | undefined;
    if (
      this.tuples.length > 0 &&
      (this.size + tuple.length + 2 > this.maxBytes || this.tuples.length >= this.maxRows)
    )
      out = this.flush();
    this.tuples.push(tuple);
    this.size += tuple.length + 2;
    return out;
  }
  flush(): string | undefined {
    if (this.tuples.length === 0) return undefined;
    const out = `${this.head}${this.tuples.join(",\n")}${this.tail}`;
    this.tuples = [];
    this.size = this.head.length + 1;
    return out;
  }
}

const inList = (ids: readonly string[]): string => ids.map(sqlLiteral).join(", ");

export type BuildOptions = {
  manifestCid: string;
  runId: string;
  /** Default "full". */
  mode?: SyncMode;
  /**
   * Incremental only: runs whose changes are pushed (default `[runId]`). Pass every run since the last
   * successful sync so a missed sync is not lost.
   */
  changedRunIds?: string[];
  batchSize?: number;
  statementsPerFile?: number;
  maxStatementBytes?: number;
  /** Filled with the number of rows written (inserted + deleted keys) per table. */
  stats?: Record<string, number>;
};

/**
 * Replaces `derived_sync_state` with the state computed by the last `buildD1Statements` run.
 * Call only after every statement was executed successfully against D1.
 */
export async function commitDerivedState(db: Db): Promise<void> {
  await withTransaction(db, async () => {
    await db.run("DELETE FROM derived_sync_state");
    await db.run("INSERT INTO derived_sync_state SELECT * FROM derived_sync_pending");
  });
}

export async function* buildD1Statements(db: Db, opts: BuildOptions): AsyncGenerator<string> {
  const mode = opts.mode ?? "full";
  const batchSize = opts.batchSize ?? 500;
  const maxBytes = opts.maxStatementBytes ?? 65_536;
  const chunker = new Chunker(opts.statementsPerFile ?? 50);
  const stats = opts.stats ?? {};
  for (const t of D1_TABLES) stats[t] = 0;
  const changed = opts.changedRunIds ?? [opts.runId];
  const runList = inList(changed);

  await db.run("DELETE FROM derived_sync_pending");
  const stored = new Map<string, string>();
  if (mode === "incremental")
    for (const r of await db.all<{ t: string; k: string; h: string }>(
      'SELECT "table" AS t, key AS k, row_hash AS h FROM derived_sync_state',
    ))
      stored.set(`${r.t}\u0000${r.k}`, r.h);

  if (mode === "full") yield `${D1_TABLES.map((t) => `DELETE FROM ${t};`).join("\n")}\n`;

  /** Reads a table (optionally filtered) in key order, in pages. */
  async function* readRows(table: D1Table, where: string): AsyncGenerator<Record<string, unknown>> {
    const cols = D1_COLUMNS[table];
    const select = cols.map((c) => selectExpr(table, c)).join(", ");
    const orderBy = PK[table].join(", ");
    for (let offset = 0; ; offset += batchSize) {
      const rows = await db.all<Record<string, unknown>>(
        `SELECT ${select} FROM ${table} ${where} ORDER BY ${orderBy} LIMIT ${batchSize} OFFSET ${offset}`,
      );
      yield* rows;
      if (rows.length < batchSize) break;
    }
  }

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

    if (mode === "incremental" && (table === "properties" || table === "permits")) {
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
      const ids = new Set(changed);
      for (const r of await db.all<{ p: string | null }>(
        `SELECT previous_run_id AS p FROM runs WHERE run_id IN (${runList})`,
      ))
        if (r.p) ids.add(r.p);
      for await (const r of readRows(table, `WHERE run_id IN (${inList([...ids])})`)) {
        stats[table] = (stats[table] ?? 0) + 1;
        yield* emit(batcher.add(tupleOf(table, r)));
      }
    } else if ((DERIVED as readonly string[]).includes(table)) {
      const t = table as DerivedTable;
      const seen = new Set<string>();
      const fresh: string[] = [];
      for await (const r of readRows(t, "")) {
        const key = PK[t].map((c) => String(r[c])).join("|");
        const hash = sha256(JSON.stringify(cols.map((c) => r[c] ?? null)));
        seen.add(key);
        fresh.push(key, hash);
        if (fresh.length >= 1000) await savePending(db, t, fresh.splice(0));
        if (mode === "incremental" && stored.get(`${t}\u0000${key}`) === hash) continue;
        stats[t] = (stats[t] ?? 0) + 1;
        yield* emit(batcher.add(tupleOf(t, r)));
      }
      await savePending(db, t, fresh);
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

/** `flat` is [key, hash, key, hash, ...]. */
async function savePending(db: Db, table: string, flat: string[]): Promise<void> {
  if (flat.length === 0) return;
  const tuples: string[] = [];
  for (let i = 0; i < flat.length; i += 2)
    tuples.push(`(${sqlLiteral(table)}, ${sqlLiteral(flat[i])}, ${sqlLiteral(flat[i + 1])})`);
  await db.run(`INSERT INTO derived_sync_pending VALUES ${tuples.join(", ")}`);
}
