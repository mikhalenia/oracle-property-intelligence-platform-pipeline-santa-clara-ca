/** Run records and the published manifest of the snapshot loaded into D1. */

type RunRecord = { runId?: string; manifestCid?: string | null };
export type Fetcher = (url: string) => Promise<Response>;

export async function runs(db: D1Database): Promise<unknown[]> {
  const { results } = await db
    .prepare("SELECT record FROM runs ORDER BY run_id DESC")
    .all<{ record: string }>();
  return results.map((r) => JSON.parse(r.record) as unknown);
}

/**
 * The snapshot's run (`snapshot.run_id`, else the newest run) with its manifest fetched from the
 * IPFS gateway. Gateway failures are reported in `error` with `manifest: null`, never thrown.
 */
export async function manifest(db: D1Database, gateway: string, fetcher: Fetcher) {
  const row = await db
    .prepare(
      `SELECT r.run_id, r.record, s.manifest_cid AS snapshot_cid FROM runs r
       LEFT JOIN snapshot s ON s.id = 1 AND s.run_id = r.run_id
       ORDER BY (s.run_id IS NOT NULL) DESC, r.run_id DESC LIMIT 1`,
    )
    .first<{ run_id: string; record: string; snapshot_cid: string | null }>();
  const record = row ? (JSON.parse(row.record) as RunRecord) : {};
  const runId = row?.run_id ?? null;
  const manifestCid = record.manifestCid ?? row?.snapshot_cid ?? null;
  if (!manifestCid)
    return { runId, manifestCid, manifestUrl: null, manifest: null, error: "run is not published" };
  const manifestUrl = `${gateway.replace(/\/+$/, "")}/ipfs/${manifestCid}`;
  try {
    const res = await fetcher(manifestUrl);
    if (!res.ok) throw new Error(`gateway responded ${res.status}`);
    return { runId, manifestCid, manifestUrl, manifest: (await res.json()) as unknown };
  } catch (err) {
    const error = `manifest fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    return { runId, manifestCid, manifestUrl, manifest: null, error };
  }
}
