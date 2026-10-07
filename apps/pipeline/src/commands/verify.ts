import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CarReader } from "@ipld/car";
import { sha256Hex, type Fetcher } from "@scc/sources";
import { mergeRunRecord, type Db } from "../db/duck";
import { PUBLIC_GATEWAYS, VENDOR_GATEWAYS } from "../publish/gateways";
import type { Manifest } from "../publish/manifest";

export type GatewayResult = {
  gateway: string;
  status: number | "error";
  bytes: number;
  sha256Match: boolean;
  ms: number;
  note?: string;
};
export type VerificationReport = {
  runId: string;
  verifiedAt: string;
  ok: boolean;
  minIndependent: number;
  gateways: string[];
  artifacts: Array<{
    cid: string;
    name: string;
    codec: string;
    size: number;
    results: GatewayResult[];
    independentOk: number;
  }>;
};
export type VerifyOptions = {
  gateways?: string[];
  minIndependent?: number;
  retries?: number;
  timeoutMs?: number;
  /** Base backoff between retries; attempt n waits backoffMs * n. */
  backoffMs?: number;
};
type Target = { cid: string; codec: string; size: number; sha256: string };

export async function verifyManifest(
  manifest: Manifest,
  fetcher: Fetcher,
  opts: VerifyOptions = {},
): Promise<VerificationReport> {
  const gateways = opts.gateways ?? [...PUBLIC_GATEWAYS, ...VENDOR_GATEWAYS];
  const minIndependent = opts.minIndependent ?? 2;
  const artifacts: VerificationReport["artifacts"] = [];
  for (const a of [...manifest.artifacts, manifest.car]) {
    const results: GatewayResult[] = [];
    for (const gw of gateways) results.push(await fetchOne(fetcher, gw, a, opts));
    const independentOk = results.filter(
      (r) => r.sha256Match && !VENDOR_GATEWAYS.includes(r.gateway),
    ).length;
    artifacts.push({
      cid: a.cid,
      name: a.name,
      codec: a.codec,
      size: a.size,
      results,
      independentOk,
    });
  }
  return {
    runId: manifest.runId,
    verifiedAt: new Date().toISOString(),
    ok: artifacts.every((a) => a.independentOk >= minIndependent),
    minIndependent,
    gateways,
    artifacts,
  };
}

async function checkBody(a: Target, bytes: Uint8Array): Promise<{ match: boolean; note?: string }> {
  if (a.codec === "directory") {
    try {
      const reader = await CarReader.fromBytes(bytes);
      const root = (await reader.getRoots())[0];
      if (!root || root.toString() !== a.cid)
        return { match: false, note: `CAR root ${root?.toString() ?? "none"} != ${a.cid}` };
      const block = await reader.get(root);
      if (!block) return { match: false, note: "CAR does not contain its root block" };
      if (block.bytes.length !== a.size)
        return { match: false, note: `root block size ${block.bytes.length} != ${a.size}` };
      if (sha256Hex(block.bytes) !== a.sha256)
        return { match: false, note: "root block sha256 mismatch" };
      return { match: true };
    } catch (err) {
      return { match: false, note: `invalid CAR: ${String(err)}` };
    }
  }
  if (bytes.length !== a.size) return { match: false, note: `size ${bytes.length} != ${a.size}` };
  if (sha256Hex(bytes) !== a.sha256) return { match: false, note: "sha256 mismatch" };
  return { match: true };
}

async function fetchOne(
  fetcher: Fetcher,
  gateway: string,
  a: Target,
  opts: VerifyOptions,
): Promise<GatewayResult> {
  const isDir = a.codec === "directory";
  const url = `https://${gateway}/ipfs/${a.cid}${isDir ? "?format=car" : ""}`;
  const retries = opts.retries ?? 2;
  const t0 = Date.now();
  const done = (r: Omit<GatewayResult, "ms">): GatewayResult => ({ ...r, ms: Date.now() - t0 });
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const last = attempt === retries + 1;
    const wait = () => new Promise((r) => setTimeout(r, (opts.backoffMs ?? 2000) * attempt));
    try {
      const res = await fetcher(url, {
        headers: isDir ? { accept: "application/vnd.ipld.car" } : {},
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      });
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && !last) {
          await wait();
          continue;
        }
        return done({
          gateway,
          status: res.status,
          bytes: bytes.length,
          sha256Match: false,
          note: new TextDecoder().decode(bytes.subarray(0, 400)).slice(0, 120),
        });
      }
      const { match, note } = await checkBody(a, bytes);
      return done({
        gateway,
        status: res.status,
        bytes: bytes.length,
        sha256Match: match,
        ...(note ? { note } : {}),
      });
    } catch (err) {
      if (last)
        return done({
          gateway,
          status: "error",
          bytes: 0,
          sha256Match: false,
          note: String(err).slice(0, 120),
        });
      await wait();
    }
  }
  return done({ gateway, status: "error", bytes: 0, sha256Match: false });
}

/**
 * Persists a verification report: `exports/<run>/verification.json`, the run's `docs/runs` record,
 * and the DuckDB run record, so the next D1 sync carries it to the Explorer.
 */
export async function recordVerification(opts: {
  db: Db;
  runId: string;
  report: VerificationReport;
  exportDir: string;
  docsRunsDir: string;
}): Promise<void> {
  const { db, runId, report } = opts;
  await writeFile(
    join(opts.exportDir, runId, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  const runFile = join(opts.docsRunsDir, `${runId}.json`);
  const record = JSON.parse(await readFile(runFile, "utf8")) as Record<string, unknown>;
  await writeFile(runFile, JSON.stringify({ ...record, verification: report }, null, 2));
  await mergeRunRecord(db, runId, { verification: report });
}
