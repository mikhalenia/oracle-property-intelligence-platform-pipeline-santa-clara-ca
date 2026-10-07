import { config } from "dotenv";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ingest } from "./commands/ingest";
import { applySchema, openDb } from "./db/duck";
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
  if (["export", "publish", "verify", "sync", "run"].includes(cmd)) {
    console.log(`${cmd}: not implemented yet`);
    return;
  }
  console.log("usage: pipeline <ingest|export|publish|verify|sync|run>");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
