import { execFile } from "node:child_process";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { exportRun } from "./commands/export";
import { ingest } from "./commands/ingest";
import { publish } from "./commands/publish";
import { sync } from "./commands/sync";
import { verifyManifest } from "./commands/verify";
import { applySchema, openDb } from "./db/duck";
import { filebaseUploader } from "./publish/filebase";
import type { Manifest } from "./publish/manifest";
import { newRunId } from "./run-id";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: join(repoRoot, ".env"), quiet: true });

const cmd = process.argv[2] ?? "help";
const dataDir = process.env["SCC_DATA_DIR"] ?? join(repoRoot, "data");
const dbPath = join(dataDir, "santa-clara.duckdb");

async function main(): Promise<void> {
  if (cmd === "ingest") {
    const now = new Date();
    await mkdir(dataDir, { recursive: true });
    const db = await openDb(dbPath);
    try {
      await applySchema(db);
      const record = await ingest({
        db,
        fetcher: fetch,
        dataDir,
        runId: newRunId(now),
        asOf: now.toISOString().slice(0, 10),
        now: now.toISOString(),
      });
      console.log(JSON.stringify(record, null, 2));
    } finally {
      await db.close();
    }
    return;
  }
  if (cmd === "export") {
    const db = await openDb(dbPath);
    try {
      await applySchema(db);
      const latest = (
        await db.all<{ run_id: string }>("SELECT run_id FROM runs ORDER BY started_at DESC LIMIT 1")
      )[0];
      if (!latest) throw new Error("no runs found; run ingest first");
      const outDir = process.env["SCC_EXPORT_DIR"] ?? join(repoRoot, "exports");
      console.log(JSON.stringify(await exportRun(db, { runId: latest.run_id, outDir }), null, 2));
    } finally {
      await db.close();
    }
    return;
  }
  if (cmd === "publish") {
    const accessKey = process.env["FILEBASE_ACCESS_KEY"];
    const secretKey = process.env["FILEBASE_SECRET_KEY"];
    const bucket = process.env["FILEBASE_BUCKET"];
    if (!accessKey || !secretKey || !bucket)
      throw new Error("FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY and FILEBASE_BUCKET must be set");
    const db = await openDb(dbPath);
    try {
      await applySchema(db);
      const latest = (
        await db.all<{ run_id: string }>("SELECT run_id FROM runs ORDER BY started_at DESC LIMIT 1")
      )[0];
      if (!latest) throw new Error("no runs found; run ingest first");
      const manifest = await publish({
        db,
        runId: latest.run_id,
        exportDir: process.env["SCC_EXPORT_DIR"] ?? join(repoRoot, "exports"),
        uploader: filebaseUploader({ accessKey, secretKey, bucket }),
        docsRunsDir: join(repoRoot, "docs/runs"),
        now: new Date().toISOString(),
      });
      console.log(JSON.stringify(manifest, null, 2));
    } finally {
      await db.close();
    }
    return;
  }
  if (cmd === "verify") {
    const exportDir = process.env["SCC_EXPORT_DIR"] ?? join(repoRoot, "exports");
    const db = await openDb(dbPath);
    let runId: string;
    try {
      await applySchema(db);
      const latest = (
        await db.all<{ run_id: string }>("SELECT run_id FROM runs ORDER BY started_at DESC LIMIT 1")
      )[0];
      if (!latest) throw new Error("no runs found; run ingest first");
      runId = latest.run_id;
    } finally {
      await db.close();
    }
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
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "sync") {
    const exportDir = process.env["SCC_EXPORT_DIR"] ?? join(repoRoot, "exports");
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
    const db = await openDb(dbPath);
    try {
      await applySchema(db);
      const latest = (
        await db.all<{ run_id: string; manifest_cid: string | null }>(
          "SELECT run_id, manifest_cid FROM runs ORDER BY started_at DESC LIMIT 1",
        )
      )[0];
      if (!latest) throw new Error("no runs found; run ingest first");
      if (!latest.manifest_cid)
        throw new Error(`run ${latest.run_id} is not published; run publish first`);
      let migrated = false;
      const res = await sync({
        db,
        runId: latest.run_id,
        manifestCid: latest.manifest_cid,
        outDir: exportDir,
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
      console.log(JSON.stringify(res, null, 2));
    } finally {
      await db.close();
    }
    return;
  }
  if (cmd === "run") {
    console.log(`${cmd}: not implemented yet`);
    return;
  }
  console.log("usage: pipeline <ingest|export|publish|verify|sync|run>");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
