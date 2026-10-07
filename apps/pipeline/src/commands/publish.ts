import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "@scc/sources";
import { mergeRunRecord, type Db } from "../db/duck";
import { packDirectory } from "../publish/car";
import type { Uploader } from "../publish/filebase";
import { buildManifest, type Manifest } from "../publish/manifest";

const EXPORT_FILES = [
  "properties.parquet",
  "permits.parquet",
  "contractors.parquet",
  "owners.parquet",
  "roof_age.parquet",
  "leads.parquet",
  "runs.json",
  "coverage.json",
  "sql-examples.json",
];

export type PublishResult = { manifest: Manifest } | { skipped: true; previousRunId: string };

/**
 * Packs, uploads and records the run's export. Each publish stores the CAR twice (~84 MB), so a run
 * whose sources were all unchanged is skipped when an earlier run is published, unless `force`.
 */
export async function publish(opts: {
  db: Db;
  runId: string;
  exportDir: string;
  uploader: Uploader;
  docsRunsDir: string;
  now: string;
  /** Publish even when nothing changed since the previous published run. */
  force?: boolean;
}): Promise<PublishResult> {
  const { db, runId, uploader } = opts;
  const dir = join(opts.exportDir, runId);
  const existing = (
    await db.all<{ manifest_cid: string | null; record: string }>(
      "SELECT manifest_cid, record::TEXT AS record FROM runs WHERE run_id = ?",
      [runId],
    )
  )[0];
  if (existing?.manifest_cid)
    throw new Error(`run ${runId} already published as ${existing.manifest_cid}`);
  const prevPublished = (
    await db.all<{ run_id: string }>(
      "SELECT run_id FROM runs WHERE manifest_cid IS NOT NULL AND run_id <> ? ORDER BY started_at DESC LIMIT 1",
      [runId],
    )
  )[0];
  if (!opts.force && prevPublished && existing && allSourcesSkipped(existing.record))
    return { skipped: true, previousRunId: prevPublished.run_id };
  const packed = await packDirectory(dir, EXPORT_FILES);

  await uploader.putFile(`${runId}/${runId}.car`, packed.carPath, { import: "car" });
  const reported = await uploader.headCid(`${runId}/${runId}.car`);
  if (reported !== packed.rootCid)
    throw new Error(`pinning service reported ${reported}, expected ${packed.rootCid}`);

  // the CAR file itself as a plain object so it is fetchable by its own CID
  await uploader.putFile(`${runId}/car/${runId}.car`, packed.carPath);
  const carCid = await uploader.headCid(`${runId}/car/${runId}.car`);

  const prev = (
    await db.all<{ manifest_cid: string }>(
      "SELECT manifest_cid FROM runs WHERE manifest_cid IS NOT NULL AND run_id <> ? ORDER BY started_at DESC LIMIT 1",
      [runId],
    )
  )[0];
  const manifest = buildManifest({
    runId,
    previousManifestCid: prev?.manifest_cid ?? null,
    publishedAt: opts.now,
    root: { cid: packed.rootCid, ...packed.rootBlock },
    entries: packed.entries,
    car: { cid: carCid, size: packed.carSize, sha256: packed.carSha256 },
  });
  const manifestPath = join(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await uploader.putFile(`${runId}/manifest.json`, manifestPath);
  const manifestCid = await uploader.headCid(`${runId}/manifest.json`);

  // recorded last: only after every upload succeeded
  await db.run("UPDATE runs SET manifest_cid = ? WHERE run_id = ?", [manifestCid, runId]);
  await mergeRunRecord(db, runId, { manifest });
  await mkdir(opts.docsRunsDir, { recursive: true });
  const row = (
    await db.all<{ record: string }>("SELECT record FROM runs WHERE run_id = ?", [runId])
  )[0];
  const runRecord: Record<string, unknown> = row ? JSON.parse(row.record) : {};
  await writeFile(
    join(opts.docsRunsDir, `${runId}.json`),
    JSON.stringify(
      {
        ...runRecord,
        manifestCid,
        manifest,
        manifestSha256: sha256Hex(await readFile(manifestPath)),
      },
      null,
      2,
    ),
  );
  return { manifest };
}

/** True when the run record shows every source unchanged (`skipped`) since the previous run. */
function allSourcesSkipped(record: string): boolean {
  const sources = Object.values(
    (JSON.parse(record) as { sources?: Record<string, { skipped?: boolean }> }).sources ?? {},
  );
  return sources.length > 0 && sources.every((s) => s.skipped === true);
}
