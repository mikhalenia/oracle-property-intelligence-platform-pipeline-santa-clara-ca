import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bboxCenter, normalizeApn } from "@scc/domain";
import { sha256Hex } from "./hash";
import { fetchWithRetry, type Fetcher } from "./http";
import { recordHash, type Provenance } from "./provenance";

export const PARCELS_URL = "https://data.sccgov.org/resource/ubcd-cewv.json";
export const PARCELS_SOURCE_KEY = "scc-parcels";

export type ParcelRow = {
  apn: string;
  situsAddress: string | null;
  situsCity: string | null;
  situsZip: string | null;
  jurisdiction: string | null;
  taxRateArea: string | null;
  lat: number | null;
  lon: number | null;
} & Provenance & { recordHash: string };

type RawParcel = {
  apn?: string;
  objectid?: string;
  situs_house_number?: string;
  situs_street_name?: string;
  situs_street_type?: string;
  situs_city_name?: string;
  situs_zip_code?: string;
  jurisdiction?: string;
  tax_rate_area?: string;
  the_geom?: { type: string; coordinates: unknown };
};

export async function fetchParcelVersion(fetcher: Fetcher): Promise<string> {
  const url = `${PARCELS_URL}?$select=${encodeURIComponent("max(:updated_at) as u")}`;
  const res = await fetchWithRetry(fetcher, url);
  const [row] = (await res.json()) as Array<{ u: string }>;
  if (!row?.u) throw new Error("parcel dataset version unavailable");
  return row.u;
}

const clean = (s: string | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

export function mapParcel(raw: RawParcel, prov: Provenance): ParcelRow | null {
  const apn = normalizeApn(raw.apn);
  if (!apn) return null;
  const addressParts = [raw.situs_house_number, raw.situs_street_name, raw.situs_street_type]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  const center = raw.the_geom ? bboxCenter(raw.the_geom.coordinates) : null;
  const base = {
    apn,
    situsAddress: addressParts.length ? addressParts.join(" ") : null,
    situsCity: clean(raw.situs_city_name),
    situsZip: clean(raw.situs_zip_code),
    jurisdiction: clean(raw.jurisdiction),
    taxRateArea: clean(raw.tax_rate_area),
    lat: center?.lat ?? null,
    lon: center?.lon ?? null,
  };
  return { ...base, ...prov, recordHash: recordHash(base) };
}

export async function* fetchParcelPages(
  fetcher: Fetcher,
  opts: {
    pageSize?: number;
    maxPages?: number;
    outDir: string;
    sourceVersion: string;
    fetchedAt: string;
  },
): AsyncGenerator<{ pageIndex: number; rows: ParcelRow[]; skippedNoApn: number }> {
  const pageSize = opts.pageSize ?? 50_000;
  await mkdir(opts.outDir, { recursive: true });
  for (let pageIndex = 0; pageIndex < (opts.maxPages ?? Infinity); pageIndex++) {
    const url = `${PARCELS_URL}?$order=objectid&$limit=${pageSize}&$offset=${pageIndex * pageSize}`;
    const res = await fetchWithRetry(fetcher, url, undefined, { retries: 4, baseDelayMs: 2000 });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const pageSha256 = sha256Hex(bytes);
    await writeFile(join(opts.outDir, `page-${String(pageIndex).padStart(4, "0")}.json`), bytes);
    const raws = JSON.parse(new TextDecoder().decode(bytes)) as RawParcel[];
    if (raws.length === 0) return;
    const prov: Provenance = {
      sourceKey: PARCELS_SOURCE_KEY,
      sourceUrl: url,
      sourceVersion: opts.sourceVersion,
      fetchedAt: opts.fetchedAt,
      pageSha256,
    };
    const rows: ParcelRow[] = [];
    let skippedNoApn = 0;
    for (const raw of raws) {
      const row = mapParcel(raw, prov);
      if (row) rows.push(row);
      else skippedNoApn++;
    }
    yield { pageIndex, rows, skippedNoApn };
    if (raws.length < pageSize) return;
  }
}
