export const API_BASE: string =
  (import.meta.env["VITE_API_BASE"] as string | undefined) ??
  "https://scc-pipeline-api.mikhalenia-a.workers.dev";

export interface SourceStat {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
  sourceVersion: string | null;
  skipped: boolean;
  skippedNoApn?: number;
  error?: string;
}

export interface VerificationResult {
  gateway: string;
  status: number | string;
  bytes: number;
  sha256Match: boolean;
  ms: number;
  note?: string;
}

export interface Verification {
  runId: string;
  verifiedAt: string;
  ok: boolean;
  minIndependent: number;
  gateways: string[];
  artifacts: {
    cid: string;
    name: string;
    codec: string;
    size: number;
    results: VerificationResult[];
    /** Number of independent gateways that served matching bytes. */
    independentOk: number;
  }[];
}

export interface RunRecord {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  asOf: string | null;
  status: string;
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
  verification?: Verification;
}

export interface Health {
  ok: boolean;
  snapshot: { runId: string; manifestCid: string; syncedAt: string } | null;
}

export interface Artifact {
  cid: string;
  name: string;
  path: string;
  size: number;
  codec: "file" | "directory";
  sha256: string;
}

export interface Manifest {
  schema: string;
  runId: string;
  publishedAt: string;
  county: string;
  state: string;
  fips: string;
  previousManifestCid: string | null;
  artifacts: Artifact[];
  car: { cid: string; name: string; size: number; sha256: string; root: string };
  gatewayUrlTemplate: string;
  ipns: string | null;
}

export interface ManifestResponse {
  runId: string | null;
  manifestCid: string | null;
  manifestUrl: string | null;
  manifest: Manifest | null;
  error?: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return (await res.json()) as T;
}

export const getHealth = () => get<Health>("/api/health");
export const getRuns = () => get<RunRecord[]>("/api/runs");
export const getManifest = () => get<ManifestResponse>("/api/manifest");
