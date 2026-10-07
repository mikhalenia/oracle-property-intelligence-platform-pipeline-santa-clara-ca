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

/** One row of `/api/leads/aged-roofs` or `/api/leads/open-permits` (see the Worker's `toLead`). */
export interface Lead {
  apn: string | null;
  situsAddress: string | null;
  situsCity: string | null;
  lat: number | null;
  lon: number | null;
  roofDate: string | null;
  roofAgeYears: number | null;
  roofAgeAnchor: string | null;
  roofAgeConfidence: string | null;
  roofAgePermit: string | null;
  permitNumber: string | null;
  permitState: string | null;
  approvalsComplete: boolean;
  daysOpen: number | null;
  issueDate: string | null;
  contractorCompany: string | null;
  cslbLicenseNumber: string | null;
  ownerName: string | null;
  distanceMiles: number;
  provenance: {
    propertySourceUrl: string | null;
    permitSourceUrl: string | null;
    permitSourceVersion: string | null;
    fetchedAt: string | null;
  };
}

export interface LeadsResponse {
  snapshot: { runId: string | null; manifestCid: string | null; syncedAt: string | null };
  items: Lead[];
}

export interface LeadsQuery {
  lat: number;
  lon: number;
  radiusMiles: number;
}

const qs = (p: object) =>
  new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();

export const getAgedRoofs = (p: LeadsQuery & { minRoofAgeYears: number }) =>
  get<LeadsResponse>(`/api/leads/aged-roofs?${qs(p)}`);
export const getOpenPermits = (p: LeadsQuery & { state: "any" | "open" | "expired_unfinaled" }) =>
  get<LeadsResponse>(`/api/leads/open-permits?${qs(p)}`);
