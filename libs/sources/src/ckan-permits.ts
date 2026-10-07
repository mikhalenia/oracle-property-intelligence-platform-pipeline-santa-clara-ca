import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "csv-parse";
import { isRoofingWork, normalizeApn, parseUsDate, splitContractor } from "@scc/domain";
import { sha256Hex } from "./hash";
import { fetchWithRetry, type Fetcher } from "./http";
import { recordHash, type Provenance } from "./provenance";

export type PermitStatusKey = "active" | "under_inspection" | "expired" | "last_30_days";
const CKAN = "https://data.sanjoseca.gov";

export const CKAN_PERMIT_RESOURCES: Record<
  PermitStatusKey,
  { packageId: string; downloadUrl: string }
> = {
  active: {
    packageId: "active-building-permits",
    downloadUrl: `${CKAN}/dataset/fd9ceb0c-75e0-402e-9fe3-3f6e04f2c23f/resource/761b7ae8-3be1-4ad6-923d-c7af6404a904/download/buildingpermitsactive.csv`,
  },
  under_inspection: {
    packageId: "building-permits-under-inspection",
    downloadUrl: `${CKAN}/dataset/ca355e55-c651-4e00-9bde-2c014f229486/resource/89ccdad9-7309-4826-a5f3-2fcf1fcb20fa/download/buildingpermitsunderinspection.csv`,
  },
  expired: {
    packageId: "expired-building-permits",
    downloadUrl: `${CKAN}/dataset/3b40d486-bd19-44c5-b854-5f0638c2afc3/resource/df4b8461-0c7a-4d16-b85d-ff7f71c5fed5/download/buildingpermitsexpired.csv`,
  },
  last_30_days: {
    packageId: "last-30-days-building-permits",
    downloadUrl: `${CKAN}/dataset/2723cdec-a639-4b63-bded-175338c45473/resource/045b3678-e923-4002-b696-300955bc6d06/download/buildingpermits30.csv`,
  },
};

export const PERMITS_SOURCE_KEY_PREFIX = "sj-permits-";

export async function fetchCkanResourceVersion(
  fetcher: Fetcher,
  packageId: string,
): Promise<string> {
  const res = await fetchWithRetry(fetcher, `${CKAN}/api/3/action/package_show?id=${packageId}`);
  const body = (await res.json()) as {
    result: { resources: Array<{ format: string; last_modified: string }> };
  };
  const csv = body.result.resources.find((r) => r.format === "CSV");
  if (!csv?.last_modified) throw new Error(`no CSV resource for ${packageId}`);
  return csv.last_modified;
}

export async function downloadPermitsCsv(fetcher: Fetcher, key: PermitStatusKey, outDir: string) {
  await mkdir(outDir, { recursive: true });
  const res = await fetchWithRetry(fetcher, CKAN_PERMIT_RESOURCES[key].downloadUrl, undefined, {
    retries: 4,
    baseDelayMs: 2000,
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const path = join(outDir, `${key}.csv`);
  await writeFile(path, bytes);
  return { path, sha256: sha256Hex(bytes), bytes: bytes.length };
}

export type PermitRow = {
  permitNumber: string;
  apn: string | null;
  status: "active" | "under_inspection" | "expired";
  isRoofing: boolean;
  workDescription: string | null;
  subtype: string | null;
  folderName: string | null;
  approvals: string | null;
  issueDate: string | null;
  finalDate: string | null;
  valuation: number | null;
  address: string | null;
  applicant: string | null;
  ownerNameRaw: string | null;
  contractorRaw: string | null;
  contractorCompany: string | null;
  contractorContact: string | null;
  folderRsn: string | null;
} & Provenance & { recordHash: string };

const STATUS_BY_CSV: Record<string, PermitRow["status"]> = {
  Active: "active",
  UnderInspection: "under_inspection",
  Expired: "expired",
};

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

type RawPermit = Partial<
  Record<
    | "Status"
    | "gx_location"
    | "ASSESSORS_PARCEL_NUMBER"
    | "APPLICANT"
    | "OWNERNAME"
    | "CONTRACTOR"
    | "FOLDERNUMBER"
    | "FOLDERNAME"
    | "SUBTYPEDESCRIPTION"
    | "WORKDESCRIPTION"
    | "PERMITAPPROVALS"
    | "ISSUEDATE"
    | "FINALDATE"
    | "PERMITVALUATION"
    | "FOLDERRSN",
    string
  >
>;

export function mapPermit(
  raw: RawPermit,
  key: PermitStatusKey,
  prov: Provenance,
): PermitRow | null {
  const permitNumber = clean(raw.FOLDERNUMBER);
  if (!permitNumber) return null;
  const status = STATUS_BY_CSV[raw.Status ?? ""] ?? (key === "last_30_days" ? "active" : null);
  if (!status) return null;
  const contractor = splitContractor(raw.CONTRACTOR ?? "");
  const workDescription = clean(raw.WORKDESCRIPTION);
  const subtype = clean(raw.SUBTYPEDESCRIPTION);
  const folderName = clean(raw.FOLDERNAME);
  const valuationNum = Number((raw.PERMITVALUATION ?? "").replace(/[^0-9.]/g, ""));
  const base = {
    permitNumber,
    apn: normalizeApn(raw.ASSESSORS_PARCEL_NUMBER),
    status,
    isRoofing: isRoofingWork({
      ...(workDescription ? { workDescription } : {}),
      ...(subtype ? { subtype } : {}),
      ...(folderName ? { folderName } : {}),
    }),
    workDescription,
    subtype,
    folderName,
    approvals: clean(raw.PERMITAPPROVALS),
    issueDate: parseUsDate(raw.ISSUEDATE),
    finalDate: parseUsDate(raw.FINALDATE),
    valuation:
      raw.PERMITVALUATION && Number.isFinite(valuationNum) && valuationNum > 0
        ? valuationNum
        : null,
    address: clean(clean(raw.gx_location)?.replace(/^,\s*|\s*,$/g, "")),
    applicant: clean(raw.APPLICANT),
    ownerNameRaw: clean(raw.OWNERNAME) === "NONE" ? null : clean(raw.OWNERNAME),
    contractorRaw: clean(raw.CONTRACTOR),
    contractorCompany: contractor.companyName,
    contractorContact: contractor.contactName,
    folderRsn: clean(raw.FOLDERRSN),
  };
  return { ...base, ...prov, recordHash: recordHash(base) };
}

export async function* parsePermitsCsv(
  path: string,
  meta: {
    key: PermitStatusKey;
    sourceUrl: string;
    sourceVersion: string;
    fetchedAt: string;
    pageSha256: string;
  },
): AsyncGenerator<PermitRow> {
  const prov: Provenance = {
    sourceKey: `${PERMITS_SOURCE_KEY_PREFIX}${meta.key}`,
    sourceUrl: meta.sourceUrl,
    sourceVersion: meta.sourceVersion,
    fetchedAt: meta.fetchedAt,
    pageSha256: meta.pageSha256,
  };
  const parser = createReadStream(path).pipe(
    parse({ columns: true, bom: true, relax_column_count: true, trim: false }),
  );
  for await (const raw of parser as AsyncIterable<RawPermit>) {
    const row = mapPermit(raw, meta.key, prov);
    if (row) yield row;
  }
}
