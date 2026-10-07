import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db/duck";
import { buildD1Statements, D1_TABLES } from "../sync/sql";

export async function sync(opts: {
  db: Db;
  runId: string;
  manifestCid: string;
  outDir: string;
  exec: (file: string) => Promise<void>;
}): Promise<{ files: number; rows: Record<string, number> }> {
  const dir = join(opts.outDir, opts.runId, "sync");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const rows: Record<string, number> = {};
  for (const t of D1_TABLES) {
    const r = await opts.db.all<{ n: number | string }>(`SELECT count(*) AS n FROM ${t}`);
    rows[t] = Number(r[0]?.n ?? 0);
  }
  let files = 0;
  for await (const chunk of buildD1Statements(opts.db, {
    manifestCid: opts.manifestCid,
    runId: opts.runId,
  })) {
    const file = join(dir, `${String(files).padStart(4, "0")}.sql`);
    await writeFile(file, chunk);
    await opts.exec(file);
    files++;
  }
  return { files, rows };
}
