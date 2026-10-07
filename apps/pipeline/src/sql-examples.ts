export type SqlExample = { id: string; title: string; sql: string };

export const SQL_EXAMPLES: SqlExample[] = [
  { id: "aged-roofs-radius", title: "Roofs older than 15 years within 5 miles of downtown San José", sql: `SELECT apn, situs_address, roof_age_years, roof_age_anchor, permit_source_url\nFROM read_parquet('{{base}}/leads.parquet')\nWHERE roof_age_years >= 15\n  AND 2 * 3958.76 * asin(sqrt(pow(sin(radians(lat - 37.3382) / 2), 2) + cos(radians(37.3382)) * cos(radians(lat)) * pow(sin(radians(lon + 121.8863) / 2), 2))) <= 5\nORDER BY roof_age_years DESC LIMIT 50` },
  { id: "long-open-roofing", title: "Open roofing permits, longest open first, with contractor", sql: `SELECT permit_number, apn, situs_address, days_open, contractor_company, cslb_license_number, permit_source_url\nFROM read_parquet('{{base}}/leads.parquet')\nWHERE permit_state = 'open'\nORDER BY days_open DESC LIMIT 50` },
  { id: "owners", title: "Properties by observed owner name", sql: `SELECT apn, owner_name, observed_on, permit_number FROM read_parquet('{{base}}/owners.parquet') WHERE owner_name ILIKE '%LLC%' LIMIT 50` },
  { id: "runs", title: "Run history", sql: `SELECT runId, status, totals FROM read_json('{{base}}/runs.json')` },
];
