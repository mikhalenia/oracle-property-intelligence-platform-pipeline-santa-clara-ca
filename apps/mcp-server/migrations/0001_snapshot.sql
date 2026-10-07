CREATE TABLE IF NOT EXISTS properties (
  apn TEXT PRIMARY KEY,
  situs_address TEXT, situs_city TEXT, situs_zip TEXT, jurisdiction TEXT,
  lat REAL, lon REAL,
  source_url TEXT, source_version TEXT, fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS permits (
  permit_number TEXT PRIMARY KEY,
  apn TEXT, status TEXT, permit_state TEXT, is_roofing INTEGER,
  work_description TEXT, subtype TEXT, folder_name TEXT, approvals TEXT,
  issue_date TEXT, final_date TEXT, days_open INTEGER, valuation REAL,
  address TEXT, applicant TEXT, owner_name_raw TEXT,
  contractor_company TEXT, contractor_contact TEXT, contractor_id TEXT,
  source_url TEXT, source_version TEXT, fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS contractors (
  contractor_id TEXT PRIMARY KEY, company_name TEXT, contact_name TEXT,
  permit_count INTEGER, roofing_permit_count INTEGER,
  cslb_license_number TEXT, cslb_status TEXT, cslb_match_method TEXT, bbb_rating TEXT,
  source_url TEXT, source_version TEXT, fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS owners (
  apn TEXT, owner_name TEXT, observed_on TEXT, permit_number TEXT,
  source_url TEXT, source_version TEXT, fetched_at TEXT,
  PRIMARY KEY (apn, permit_number)
);
CREATE TABLE IF NOT EXISTS roof_age (
  apn TEXT PRIMARY KEY, roof_date TEXT, roof_age_years INTEGER,
  anchor TEXT, confidence TEXT, permit_number TEXT,
  source_url TEXT, source_version TEXT, fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, record TEXT
);
CREATE TABLE IF NOT EXISTS snapshot (
  id INTEGER PRIMARY KEY, run_id TEXT, manifest_cid TEXT, synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_properties_lat_lon ON properties(lat, lon);
CREATE INDEX IF NOT EXISTS idx_permits_apn ON permits(apn);
CREATE INDEX IF NOT EXISTS idx_permits_state ON permits(permit_state, is_roofing);
CREATE INDEX IF NOT EXISTS idx_roof_age_years ON roof_age(roof_age_years);
CREATE INDEX IF NOT EXISTS idx_owners_apn ON owners(apn);
