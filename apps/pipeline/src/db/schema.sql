CREATE TABLE IF NOT EXISTS properties (
  apn TEXT PRIMARY KEY,
  situs_address TEXT, situs_city TEXT, situs_zip TEXT, jurisdiction TEXT, tax_rate_area TEXT,
  lat DOUBLE, lon DOUBLE,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL, page_sha256 TEXT NOT NULL, record_hash TEXT NOT NULL,
  first_seen_run TEXT NOT NULL, last_seen_run TEXT NOT NULL, last_changed_run TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS permits (
  permit_number TEXT PRIMARY KEY,
  apn TEXT, status TEXT NOT NULL, permit_state TEXT, is_roofing BOOLEAN NOT NULL,
  work_description TEXT, subtype TEXT, folder_name TEXT, approvals TEXT,
  issue_date DATE, final_date DATE, days_open INTEGER, valuation DOUBLE,
  address TEXT, applicant TEXT, owner_name_raw TEXT, contractor_raw TEXT,
  contractor_company TEXT, contractor_contact TEXT, contractor_id TEXT, folder_rsn TEXT,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL, page_sha256 TEXT NOT NULL, record_hash TEXT NOT NULL,
  first_seen_run TEXT NOT NULL, last_seen_run TEXT NOT NULL, last_changed_run TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contractors (
  contractor_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, contact_name TEXT,
  permit_count INTEGER NOT NULL, roofing_permit_count INTEGER NOT NULL,
  cslb_license_number TEXT, cslb_status TEXT, cslb_match_method TEXT, bbb_rating TEXT,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS owners (
  apn TEXT NOT NULL, owner_name TEXT NOT NULL, observed_on DATE, permit_number TEXT NOT NULL,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TIMESTAMP NOT NULL,
  PRIMARY KEY (apn, permit_number)
);
CREATE TABLE IF NOT EXISTS roof_age (
  apn TEXT PRIMARY KEY, roof_date DATE NOT NULL, roof_age_years INTEGER NOT NULL,
  anchor TEXT NOT NULL, confidence TEXT NOT NULL, permit_number TEXT NOT NULL,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, started_at TIMESTAMP NOT NULL, finished_at TIMESTAMP, as_of DATE NOT NULL,
  status TEXT NOT NULL, record JSON NOT NULL, manifest_cid TEXT, previous_run_id TEXT
);
