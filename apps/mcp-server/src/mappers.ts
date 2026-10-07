/** Snake_case D1 rows -> camelCase API shapes. The only place field names are translated. */

type Nullable<T> = { [K in keyof T]: T[K] | null };

export type LeadRow = Nullable<{
  apn: string;
  situs_address: string;
  situs_city: string;
  situs_zip: string;
  jurisdiction: string;
  lat: number;
  lon: number;
  roof_date: string;
  roof_age_years: number;
  roof_age_anchor: string;
  roof_age_confidence: string;
  roof_age_permit: string;
  permit_number: string;
  permit_state: string;
  days_open: number;
  issue_date: string;
  final_date: string;
  work_description: string;
  contractor_company: string;
  contractor_id: string;
  cslb_license_number: string;
  cslb_status: string;
  owner_name: string;
  owner_observed_on: string;
  property_source_url: string;
  property_source_version: string;
  property_fetched_at: string;
  permit_source_url: string;
  permit_source_version: string;
}>;

export type PropertyRow = Nullable<{
  apn: string;
  situs_address: string;
  situs_city: string;
  situs_zip: string;
  jurisdiction: string;
  lat: number;
  lon: number;
  source_url: string;
  source_version: string;
  fetched_at: string;
}>;

export type PermitRow = Nullable<{
  permit_number: string;
  apn: string;
  status: string;
  permit_state: string;
  is_roofing: number;
  work_description: string;
  subtype: string;
  approvals: string;
  issue_date: string;
  final_date: string;
  days_open: number;
  valuation: number;
  address: string;
  contractor_company: string;
  contractor_id: string;
  source_url: string;
  source_version: string;
  fetched_at: string;
}>;

export type RoofAgeRow = Nullable<{
  roof_date: string;
  roof_age_years: number;
  anchor: string;
  confidence: string;
  permit_number: string;
}>;

export type OwnerRow = Nullable<{ owner_name: string; observed_on: string; permit_number: string }>;

export type ContractorRow = Nullable<{
  contractor_id: string;
  company_name: string;
  contact_name: string;
  permit_count: number;
  roofing_permit_count: number;
  cslb_license_number: string;
  cslb_status: string;
  cslb_match_method: string;
  bbb_rating: string;
}>;

export type SnapshotRow = Nullable<{ run_id: string; manifest_cid: string; synced_at: string }>;

export function toSnapshot(row: SnapshotRow | null) {
  return {
    runId: row?.run_id ?? null,
    manifestCid: row?.manifest_cid ?? null,
    syncedAt: row?.synced_at ?? null,
  };
}

export function toLead(row: LeadRow, distanceMiles: number) {
  return {
    apn: row.apn,
    situsAddress: row.situs_address,
    situsCity: row.situs_city,
    situsZip: row.situs_zip,
    jurisdiction: row.jurisdiction,
    lat: row.lat,
    lon: row.lon,
    roofDate: row.roof_date,
    roofAgeYears: row.roof_age_years,
    roofAgeAnchor: row.roof_age_anchor,
    roofAgeConfidence: row.roof_age_confidence,
    roofAgePermit: row.roof_age_permit,
    permitNumber: row.permit_number,
    permitState: row.permit_state,
    daysOpen: row.days_open,
    issueDate: row.issue_date,
    finalDate: row.final_date,
    workDescription: row.work_description,
    contractorCompany: row.contractor_company,
    contractorId: row.contractor_id,
    cslbLicenseNumber: row.cslb_license_number,
    cslbStatus: row.cslb_status,
    bbbRating: null,
    ownerName: row.owner_name,
    ownerObservedOn: row.owner_observed_on,
    distanceMiles,
    provenance: {
      propertySourceUrl: row.property_source_url,
      propertySourceVersion: row.property_source_version,
      propertyFetchedAt: row.property_fetched_at,
      permitSourceUrl: row.permit_source_url,
      permitSourceVersion: row.permit_source_version,
      fetchedAt: row.property_fetched_at,
    },
  };
}

export type Lead = ReturnType<typeof toLead>;

export function toProperty(row: PropertyRow) {
  return {
    apn: row.apn,
    situsAddress: row.situs_address,
    situsCity: row.situs_city,
    situsZip: row.situs_zip,
    jurisdiction: row.jurisdiction,
    lat: row.lat,
    lon: row.lon,
    sourceUrl: row.source_url,
    sourceVersion: row.source_version,
    fetchedAt: row.fetched_at,
  };
}

export function toPermit(row: PermitRow) {
  return {
    permitNumber: row.permit_number,
    apn: row.apn,
    status: row.status,
    permitState: row.permit_state,
    isRoofing: row.is_roofing === 1,
    workDescription: row.work_description,
    subtype: row.subtype,
    approvals: row.approvals,
    issueDate: row.issue_date,
    finalDate: row.final_date,
    daysOpen: row.days_open,
    valuation: row.valuation,
    address: row.address,
    contractorCompany: row.contractor_company,
    contractorId: row.contractor_id,
    sourceUrl: row.source_url,
    sourceVersion: row.source_version,
    fetchedAt: row.fetched_at,
  };
}

export function toRoofAge(row: RoofAgeRow | null) {
  if (!row) return null;
  return {
    roofDate: row.roof_date,
    roofAgeYears: row.roof_age_years,
    anchor: row.anchor,
    confidence: row.confidence,
    permitNumber: row.permit_number,
  };
}

export function toOwner(row: OwnerRow) {
  return {
    ownerName: row.owner_name,
    observedOn: row.observed_on,
    permitNumber: row.permit_number,
  };
}

export function toContractor(row: ContractorRow) {
  return {
    contractorId: row.contractor_id,
    companyName: row.company_name,
    contactName: row.contact_name,
    permitCount: row.permit_count,
    roofingPermitCount: row.roofing_permit_count,
    cslbLicenseNumber: row.cslb_license_number,
    cslbStatus: row.cslb_status,
    cslbMatchMethod: row.cslb_match_method,
    bbbRating: row.bbb_rating,
  };
}
