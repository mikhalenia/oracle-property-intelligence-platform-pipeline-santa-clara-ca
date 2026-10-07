import { execFile } from "node:child_process";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { exportRun } from "./commands/export";
import { ingest } from "./commands/ingest";
import { publish } from "./commands/publish";
import { runPipeline } from "./commands/run";
import { sync } from "./commands/sync";
import { chooseMode, clearSyncState, readSyncState, writeSyncState } from "./sync/state";
import { commitDerivedState } from "./sync/sql";
import { verifyManifest } from "./commands/verify";
import { applySchema, openDb, type Db } from "./db/duck";
import { filebaseUploader } from "./publish/filebase";
import type { Manifest } from "./publish/manifest";
import { newRunId } from "./run-id";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: join(repoRoot, ".env"), quiet: true });

const cmd = process.argv[2] ?? "help";
const dataDir = process.env["SCC_DATA_DIR"] ?? join(repoRoot, "data");
const dbPath = join(dataDir, "santa-clara.duckdb");

const exportDirOf = () => process.env["SCC_EXPORT_DIR"] ?? join(repoRoot, "exports");

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  await mkdir(dataDir, { recursive: true });
  const db = await openDb(dbPath);
  try {
    await applySchema(db);
    return await fn(db);
  } finally {
    await db.close();
  }
}

/** Explicit run id, or the most recent run when none is given. */
async function resolveRun(
  db: Db,
  runId?: string,
): Promise<{ run_id: string; manifest_cid: string | null }> {
  const rows = await db.all<{ run_id: string; manifest_cid: string | null }>(
    runId
      ? "SELECT run_id, manifest_cid FROM runs WHERE run_id = ?"
      : "SELECT run_id, manifest_cid FROM runs ORDER BY started_at DESC LIMIT 1",
    runId ? [runId] : [],
  );
  if (!rows[0]) throw new Error("no runs found; run ingest first");
  return rows[0];
}

async function ingestStep(): Promise<string> {
  const now = new Date();
  return withDb(async (db) => {
    const record = await ingest({
      db,
      fetcher: fetch,
      dataDir,
      runId: newRunId(now),
      asOf: now.toISOString().slice(0, 10),
      now: now.toISOString(),
    });
    console.log(JSON.stringify(record, null, 2));
    return record.runId;
  });
}

async function exportStep(runId?: string): Promise<void> {
  await withDb(async (db) => {
    const run = await resolveRun(db, runId);
    console.log(
      JSON.stringify(await exportRun(db, { runId: run.run_id, outDir: exportDirOf() }), null, 2),
    );
  });
}

async function publishStep(runId?: string): Promise<void> {
  const accessKey = process.env["FILEBASE_ACCESS_KEY"];
  const secretKey = process.env["FILEBASE_SECRET_KEY"];
  const bucket = process.env["FILEBASE_BUCKET"];
  if (!accessKey || !secretKey || !bucket)
    throw new Error("FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY and FILEBASE_BUCKET must be set");
  await withDb(async (db) => {
    const run = await resolveRun(db, runId);
    const manifest = await publish({
      db,
      runId: run.run_id,
      exportDir: exportDirOf(),
      uploader: filebaseUploader({ accessKey, secretKey, bucket }),
      docsRunsDir: join(repoRoot, "docs/runs"),
      now: new Date().toISOString(),
    });
    console.log(JSON.stringify(manifest, null, 2));
  });
}

async function verifyStep(runIdArg?: string): Promise<void> {
  const exportDir = exportDirOf();
  const runId = (await withDb((db) => resolveRun(db, runIdArg))).run_id;
  const manifestPath = join(exportDir, runId, "manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  } catch {
    throw new Error(`no manifest for run ${runId} at ${manifestPath}; run publish first`);
  }
  const report = await verifyManifest(manifest, fetch);
  await writeFile(join(exportDir, runId, "verification.json"), JSON.stringify(report, null, 2));
  const runFile = join(repoRoot, "docs/runs", `${runId}.json`);
  const record = JSON.parse(await readFile(runFile, "utf8")) as Record<string, unknown>;
  await writeFile(runFile, JSON.stringify({ ...record, verification: report }, null, 2));
  for (const a of report.artifacts)
    console.log(`${a.name} ${a.cid} ${a.independentOk}/${report.gateways.length}`);
  console.log(report.ok ? "verification ok" : "verification FAILED");
  if (!report.ok) throw new Error("verification failed");
}

async function syncStep(runId?: string, forceFull = false): Promise<void> {
  const cwd = join(repoRoot, "apps/mcp-server");
  const wrangler = async (args: string[]): Promise<void> => {
    try {
      await promisify(execFile)("npx", ["wrangler", ...args], {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      throw new Error(`wrangler ${args.join(" ")} failed: ${e.stderr || e.message}`, {
        cause: err,
      });
    }
  };
  await withDb(async (db) => {
    const latest = await resolveRun(db, runId);
    if (!latest.manifest_cid)
      throw new Error(`run ${latest.run_id} is not published; run publish first`);
    // Incremental needs (a) the marker from a previous successful sync, (b) a populated
    // derived_sync_state to diff the rebuilt tables against. Only syncs from this code write both
    // (full mode populates them too); earlier full syncs wrote neither, so they fall back to full.
    const state = await readSyncState(dataDir);
    const derivedStateRows = Number(
      (await db.all<{ n: number }>("SELECT count(*) AS n FROM derived_sync_state"))[0]?.n ?? 0,
    );
    const changedRunIds = state
      ? (
          await db.all<{ run_id: string }>(
            `SELECT run_id FROM runs WHERE started_at > (SELECT started_at FROM runs WHERE run_id = ?)
             AND started_at <= (SELECT started_at FROM runs WHERE run_id = ?) ORDER BY started_at`,
            [state.runId, latest.run_id],
          )
        ).map((r) => r.run_id)
      : [];
    const mode = chooseMode(
      {
        full: forceFull,
        derivedStateRows,
        lastSyncedRunKnown: changedRunIds.length > 0 && changedRunIds.includes(latest.run_id),
      },
      state,
    );
    console.log(`D1 sync mode: ${mode}`);
    if (mode === "full") await clearSyncState(dataDir);
    let migrated = false;
    const res = await sync({
      db,
      runId: latest.run_id,
      manifestCid: latest.manifest_cid,
      mode,
      changedRunIds,
      outDir: exportDirOf(),
      exec: async (file) => {
        if (!migrated) {
          console.log("applying D1 migrations");
          await wrangler(["d1", "migrations", "apply", "scc-snapshot", "--remote"]);
          migrated = true;
        }
        console.log(`executing ${file}`);
        await wrangler([
          "d1",
          "execute",
          "scc-snapshot",
          "--remote",
          "--file",
          resolve(file),
          "--yes",
        ]);
      },
    });
    const rowsWritten = Object.values(res.rows).reduce((a, b) => a + b, 0) + 1;
    await commitDerivedState(db);
    await writeSyncState(dataDir, {
      runId: latest.run_id,
      mode: res.mode,
      syncedAt: new Date().toISOString(),
      rowsWritten,
    });
    console.log(JSON.stringify(res, null, 2));
    console.log(`D1 rows written: ${rowsWritten.toLocaleString("en-US")} (free tier: 100,000/day)`);
  });
}

async function main(): Promise<void> {
  if (cmd === "ingest") await ingestStep();
  else if (cmd === "export") await exportStep();
  else if (cmd === "publish") await publishStep();
  else if (cmd === "verify") await verifyStep();
  else if (cmd === "sync") await syncStep(undefined, process.argv.includes("--full"));
  else if (cmd === "run") {
    const res = await runPipeline({
      ingest: ingestStep,
      export: exportStep,
      publish: publishStep,
      verify: verifyStep,
      sync: syncStep,
    });
    console.log(res.summary);
    if (!res.ok) process.exitCode = 1;
  } else console.log("usage: pipeline <ingest|export|publish|verify|sync|run>");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
