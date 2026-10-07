import { sha256Hex } from "./hash";

export type Provenance = {
  sourceKey: string;
  sourceUrl: string;
  sourceVersion: string;
  fetchedAt: string;
  pageSha256: string;
};

const PROVENANCE_KEYS = new Set([
  "sourceKey",
  "sourceUrl",
  "sourceVersion",
  "fetchedAt",
  "pageSha256",
  "recordHash",
]);

/** Stable hash of the normalized record, excluding provenance fields. */
export function recordHash(record: Record<string, unknown>): string {
  const keys = Object.keys(record)
    .filter((k) => !PROVENANCE_KEYS.has(k))
    .sort();
  return sha256Hex(JSON.stringify(keys.map((k) => [k, record[k] ?? null])));
}
