import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CKAN_PERMIT_RESOURCES,
  downloadPermitsCsv,
  fetchCkanResourceVersion,
  fetchParcelPages,
  fetchParcelVersion,
  parsePermitsCsv,
  PARCELS_SOURCE_KEY,
  PERMITS_SOURCE_KEY_PREFIX,
  type Fetcher,
  type PermitStatusKey,
} from "@scc/sources";
import { deriveAll } from "../db/derive";
import type { Db } from "../db/duck";
import { upsertTable, type Delta } from "../db/upsert";

export type SourceStat = Delta & { sourceVersion: string; skipped: boolean; error?: string };
export type RunRecord = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  asOf: string;
  status: "complete" | "partial";
  sources: Record<string, SourceStat>;
  totals: {
    properties: number;
    permits: number;
    roofingPermits: number;
    contractors: number;
    owners: number;
    roofAge: number;
  };
  limitations: string[];
  previousRunId: string | null;
  manifestCid: string | null;
};

const ZERO: Delta = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, removed: 0 };
const PERMIT_KEYS: PermitStatusKey[] = ["active", "under_inspection", "expired"];

const STATIC_LIMITATIONS = [
  "Permits cover the City of San José only; the other 15 jurisdictions have no open bulk feed in this milestone.",
  "No public owner mailing address or transfer date (Assessor roll is paid); ownership is observed from permit records.",
  "No public year-built field; roof age is derived only from completed roofing permits.",
  "BBB ratings are not publicly downloadable; bbb_rating is always null.",
];

export async function ingest(opts: {
  db: Db;
  fetcher: Fetcher;
  dataDir: string;
  runId: string;
  asOf: string;
  now: string;
}): Promise<RunRecord> {
  const { db, fetcher, runId, asOf, now } = opts;
  const rawDir = join(opts.dataDir, "raw", runId);
  await mkdir(rawDir, { recursive: true });
  const prev = (
    await db.all<{ run_id: string; record: string }>(
      "SELECT run_id, record FROM runs ORDER BY started_at DESC LIMIT 1",
    )
  )[0];
  const prevRecord = prev ? (JSON.parse(prev.record) as RunRecord) : null;
  const sources: Record<string, SourceStat> = {};
  const limitations = [...STATIC_LIMITATIONS];
  let status: RunRecord["status"] = "complete";

  // parcels
  try {
    const version = await fetchParcelVersion(fetcher);
    if (prevRecord?.sources[PARCELS_SOURCE_KEY]?.sourceVersion === version) {
      sources[PARCELS_SOURCE_KEY] = { ...ZERO, sourceVersion: version, skipped: true };
    } else {
      const staging = join(rawDir, "parcels.ndjson");
      await writeFile(staging, "");
      for await (const page of fetchParcelPages(fetcher, {
        outDir: join(rawDir, PARCELS_SOURCE_KEY),
        sourceVersion: version,
        fetchedAt: now,
      })) {
        await appendFile(
          staging,
          page.rows.map((r) => JSON.stringify(toSnake(r))).join("\n") + "\n",
        );
      }
      const delta = await upsertTable(db, {
        table: "properties",
        stagingNdjsonPath: staging,
        key: "apn",
        runId,
        fullSource: true,
      });
      sources[PARCELS_SOURCE_KEY] = { ...delta, sourceVersion: version, skipped: false };
    }
  } catch (err) {
    status = "partial";
    sources[PARCELS_SOURCE_KEY] = {
      ...ZERO,
      sourceVersion: "",
      skipped: false,
      error: String(err),
    };
    limitations.push(`scc-parcels failed: ${String(err)}`);
  }

  // permits: all three status files into one staging file (dedupe precedence inside upsert)
  const staging = join(rawDir, "permits.ndjson");
  await writeFile(staging, "");
  let anyPermitChange = false;
  let anyPermitFailed = false;
  for (const key of PERMIT_KEYS) {
    const sourceKey = `${PERMITS_SOURCE_KEY_PREFIX}${key}`;
    try {
      const version = await fetchCkanResourceVersion(fetcher, CKAN_PERMIT_RESOURCES[key].packageId);
      const file = await downloadPermitsCsv(fetcher, key, join(rawDir, "permits"));
      let fetched = 0;
      for await (const row of parsePermitsCsv(file.path, {
        key,
        sourceUrl: CKAN_PERMIT_RESOURCES[key].downloadUrl,
        sourceVersion: version,
        fetchedAt: now,
        pageSha256: file.sha256,
      })) {
        await appendFile(staging, JSON.stringify(toSnake(row)) + "\n");
        fetched++;
      }
      const skipped = prevRecord?.sources[sourceKey]?.sourceVersion === version;
      anyPermitChange ||= !skipped;
      sources[sourceKey] = { ...ZERO, fetched, sourceVersion: version, skipped };
    } catch (err) {
      status = "partial";
      anyPermitFailed = true;
      sources[sourceKey] = { ...ZERO, sourceVersion: "", skipped: false, error: String(err) };
      limitations.push(`${sourceKey} failed: ${String(err)}`);
    }
  }
  // a missing file would make the full reload delete its permits, so only reload when all three arrived
  if (anyPermitChange && !anyPermitFailed) {
    const delta = await upsertTable(db, {
      table: "permits",
      stagingNdjsonPath: staging,
      key: "permit_number",
      runId,
      fullSource: true,
    });
    // attribute deltas to the combined feed; per-file counts stay in `fetched`
    sources["sj-permits"] = {
      ...delta,
      sourceVersion: PERMIT_KEYS.map(
        (k) => sources[`${PERMITS_SOURCE_KEY_PREFIX}${k}`]?.sourceVersion ?? "",
      ).join("|"),
      skipped: false,
    };
  }

  const derived = await deriveAll(db, asOf);
  const n = async (sql: string) => (await db.all<{ n: number }>(sql))[0]?.n ?? 0;
  const record: RunRecord = {
    runId,
    startedAt: now,
    finishedAt: new Date().toISOString(),
    asOf,
    status,
    sources,
    totals: {
      properties: await n("SELECT count(*)::INT n FROM properties"),
      permits: await n("SELECT count(*)::INT n FROM permits"),
      roofingPermits: await n("SELECT count(*)::INT n FROM permits WHERE is_roofing"),
      contractors: derived.contractors,
      owners: derived.owners,
      roofAge: derived.roofAgeRows,
    },
    limitations,
    previousRunId: prev?.run_id ?? null,
    manifestCid: null,
  };
  await db.run(
    "INSERT INTO runs (run_id, started_at, finished_at, as_of, status, record, manifest_cid, previous_run_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    [runId, now, record.finishedAt, asOf, status, JSON.stringify(record), record.previousRunId],
  );
  return record;
}

function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]),
  );
}
