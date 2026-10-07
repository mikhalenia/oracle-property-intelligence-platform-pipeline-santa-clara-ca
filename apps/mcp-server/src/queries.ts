import { boundingBox, haversineMiles } from "@scc/domain/geo";
import {
  toContractor,
  toLead,
  toOwner,
  toPermit,
  toProperty,
  toRoofAge,
  toSnapshot,
  type ContractorRow,
  type Lead,
  type LeadRow,
  type OwnerRow,
  type PermitRow,
  type PropertyRow,
  type RoofAgeRow,
  type SnapshotRow,
} from "./mappers";
import type { AgedRoofsParams, OpenPermitsParams, RadiusParams } from "./schemas";

export { manifest, runs } from "./runs";

const MAX_CANDIDATES = 2000;

/** Latest roofing permit per APN: open first, then newest issue_date, then permit_number. */
const LATEST_ROOFING_PERMIT = `(SELECT x.permit_number FROM permits x WHERE x.apn = pr.apn AND x.is_roofing = 1
  ORDER BY (x.permit_state = 'open') DESC, x.issue_date DESC, x.permit_number LIMIT 1)`;

/** Latest owner per APN: newest observed_on (NULLs last), then permit_number. */
const LATEST_OWNER = `(SELECT y.permit_number FROM owners y WHERE y.apn = pr.apn
  ORDER BY y.observed_on IS NULL, y.observed_on DESC, y.permit_number LIMIT 1)`;

const LEAD_COLUMNS = `pr.apn, pr.situs_address, pr.situs_city, pr.situs_zip, pr.jurisdiction, pr.lat, pr.lon,
  ra.roof_date, ra.roof_age_years, ra.anchor AS roof_age_anchor, ra.confidence AS roof_age_confidence,
  ra.permit_number AS roof_age_permit,
  rp.permit_number, rp.permit_state, rp.days_open, rp.issue_date, rp.final_date, rp.work_description,
  rp.contractor_company, rp.contractor_id, c.cslb_license_number, c.cslb_status,
  o.owner_name, o.observed_on AS owner_observed_on,
  pr.source_url AS property_source_url, pr.source_version AS property_source_version,
  pr.fetched_at AS property_fetched_at,
  rp.source_url AS permit_source_url, rp.source_version AS permit_source_version`;

/**
 * `permitJoin` decides which permit a row carries: the latest roofing permit, or each matching permit.
 * `source` is the property rows to start from: the table, or a pre-limited candidate subquery.
 */
function leadsFrom(permitJoin: string, source = "properties"): string {
  return `SELECT ${LEAD_COLUMNS}
  FROM ${source} pr
  ${permitJoin}
  LEFT JOIN roof_age ra ON ra.apn = pr.apn
  LEFT JOIN contractors c ON c.contractor_id = rp.contractor_id
  LEFT JOIN owners o ON o.apn = pr.apn AND o.permit_number = ${LATEST_OWNER}`;
}

const LATEST_PERMIT_JOIN = `LEFT JOIN permits rp ON rp.permit_number = ${LATEST_ROOFING_PERMIT}`;
const LATEST_LEADS = leadsFrom(LATEST_PERMIT_JOIN);
const PERMIT_LEADS = leadsFrom(`JOIN permits rp ON rp.apn = pr.apn`);

const IN_BOX = "pr.lat BETWEEN ?1 AND ?2 AND pr.lon BETWEEN ?3 AND ?4";
/** Planar squared-distance proxy so the candidate LIMIT keeps the nearest rows. */
const NEAREST = "((pr.lat - ?5) * (pr.lat - ?5) + (pr.lon - ?6) * (pr.lon - ?6) * ?7)";

/**
 * Radius has no selective filter besides the box, which at 25 miles covers most of the ~494k
 * parcels. Joining first would run both correlated subqueries (latest permit, latest owner) for
 * every parcel in the box before the LIMIT, so the nearest ?8 candidates are picked from
 * `properties` alone (uses idx_properties_lat_lon) and only those rows are joined. The LIMIT keeps
 * SQLite from flattening the subquery. Aged roofs and open permits stay join-first: their filters
 * (roof_age, permit state) already restrict them to a few thousand rows.
 */
const RADIUS_CANDIDATES = `(SELECT * FROM properties pr WHERE ${IN_BOX} ORDER BY ${NEAREST} LIMIT ?8)`;
export const RADIUS_SQL = spatialSql(leadsFrom(LATEST_PERMIT_JOIN, RADIUS_CANDIDATES), NEAREST);

function spatialSql(from: string, orderBy: string, where?: string): string {
  return `${from} WHERE ${where ? `${IN_BOX} AND ${where}` : IN_BOX} ORDER BY ${orderBy} LIMIT ?8`;
}

type Spatial = RadiusParams;

async function spatialLeads(
  db: D1Database,
  p: Spatial,
  sql: string,
  extra: unknown[],
  sort: (a: Lead, b: Lead) => number,
): Promise<Lead[]> {
  const box = boundingBox(p, p.radiusMiles);
  const cosLat = Math.cos((p.lat * Math.PI) / 180);
  const candidates = Math.min(p.limit * 4, MAX_CANDIDATES);
  const { results } = await db
    .prepare(sql)
    .bind(
      box.minLat,
      box.maxLat,
      box.minLon,
      box.maxLon,
      p.lat,
      p.lon,
      cosLat * cosLat,
      candidates,
      ...extra,
    )
    .all<LeadRow>();
  return results
    .map((r) => toLead(r, round3(haversineMiles(p, { lat: r.lat ?? NaN, lon: r.lon ?? NaN }))))
    .filter((l) => l.distanceMiles <= p.radiusMiles)
    .sort(sort)
    .slice(0, p.limit);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const byDistance = (a: Lead, b: Lead) => a.distanceMiles - b.distanceMiles;

export async function snapshot(db: D1Database) {
  const row = await db
    .prepare("SELECT run_id, manifest_cid, synced_at FROM snapshot WHERE id = 1")
    .first<SnapshotRow>();
  return toSnapshot(row);
}

export function radius(db: D1Database, p: RadiusParams): Promise<Lead[]> {
  return spatialLeads(db, p, RADIUS_SQL, [], byDistance);
}

export function agedRoofs(db: D1Database, p: AgedRoofsParams): Promise<Lead[]> {
  return spatialLeads(
    db,
    p,
    spatialSql(LATEST_LEADS, `ra.roof_age_years DESC, ${NEAREST}`, "ra.roof_age_years >= ?9"),
    [p.minRoofAgeYears],
    (a, b) => (b.roofAgeYears ?? 0) - (a.roofAgeYears ?? 0) || byDistance(a, b),
  );
}

export function openPermits(db: D1Database, p: OpenPermitsParams): Promise<Lead[]> {
  const states = p.state === "any" ? ["open", "expired_unfinaled"] : [p.state];
  const where = [
    "rp.permit_state IN (?9, ?10)",
    "COALESCE(rp.days_open, 0) >= ?11",
    ...(p.roofingOnly ? ["rp.is_roofing = 1"] : []),
  ].join(" AND ");
  return spatialLeads(
    db,
    p,
    spatialSql(PERMIT_LEADS, `rp.days_open DESC, ${NEAREST}`, where),
    [states[0], states[1] ?? states[0], Math.ceil(p.minOpenYears * 365)],
    (a, b) => (b.daysOpen ?? 0) - (a.daysOpen ?? 0) || byDistance(a, b),
  );
}

export async function property(db: D1Database, apn: string) {
  const prop = await db
    .prepare(
      "SELECT apn, situs_address, situs_city, situs_zip, jurisdiction, lat, lon, source_url, source_version, fetched_at FROM properties WHERE apn = ?1",
    )
    .bind(apn)
    .first<PropertyRow>();
  if (!prop) return null;
  const [snap, permits, roofAge, owners, contractors] = await Promise.all([
    snapshot(db),
    db
      .prepare("SELECT * FROM permits WHERE apn = ?1 ORDER BY issue_date DESC, permit_number")
      .bind(apn)
      .all<PermitRow>(),
    db
      .prepare(
        "SELECT roof_date, roof_age_years, anchor, confidence, permit_number FROM roof_age WHERE apn = ?1",
      )
      .bind(apn)
      .first<RoofAgeRow>(),
    db
      .prepare(
        "SELECT owner_name, observed_on, permit_number FROM owners WHERE apn = ?1 ORDER BY observed_on IS NULL, observed_on DESC, permit_number",
      )
      .bind(apn)
      .all<OwnerRow>(),
    db
      .prepare(
        "SELECT * FROM contractors WHERE contractor_id IN (SELECT contractor_id FROM permits WHERE apn = ?1) ORDER BY company_name",
      )
      .bind(apn)
      .all<ContractorRow>(),
  ]);
  return {
    snapshot: snap,
    property: toProperty(prop),
    permits: permits.results.map(toPermit),
    roofAge: toRoofAge(roofAge),
    owners: owners.results.map(toOwner),
    contractors: contractors.results.map(toContractor),
  };
}

export async function contractor(db: D1Database, id: string) {
  const row = await db
    .prepare("SELECT * FROM contractors WHERE contractor_id = ?1")
    .bind(id)
    .first<ContractorRow>();
  if (!row) return null;
  const [snap, permits] = await Promise.all([
    snapshot(db),
    db
      .prepare(
        "SELECT * FROM permits WHERE contractor_id = ?1 ORDER BY issue_date DESC, permit_number",
      )
      .bind(id)
      .all<PermitRow>(),
  ]);
  return { snapshot: snap, contractor: toContractor(row), permits: permits.results.map(toPermit) };
}
