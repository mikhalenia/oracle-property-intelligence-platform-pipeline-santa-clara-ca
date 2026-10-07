# Santa Clara County property intelligence pipeline — design

Date: 2026-10-07. Status: approved for implementation.

## 1. Intent

A roofing CRM (and any MCP-capable agent) can query provenance-tracked Santa Clara County
property, permit, ownership and contractor records — refreshed incrementally and published as
immutable, content-addressed IPFS snapshots — without Oracle paying for always-on
infrastructure.

Success for this milestone:

- Two or more real pipeline runs with recorded deltas and distinct published CIDs.
- Every published artifact retrievable by CID from two public gateways we do not operate, with
  size and SHA-256 matching the manifest.
- A hosted Explorer UI, a hosted MCP endpoint and a DuckDB query layer over the published
  Parquet, all reachable by an evaluator without running anything locally.
- Radius, roof-age, open-permit, contractor and ownership questions answered from real records.

## 2. Scope and constraints

- County: Santa Clara, CA (FIPS 06085). Permits: City of San José only in this milestone; the
  other 15 jurisdictions are catalogued as gaps.
- Budget: zero. Cloudflare free tier (Workers with static assets, D1), Filebase free tier (IPFS pinning),
  GitHub Actions free minutes. No AWS. The team kit's Golden Path prescribes AWS + CDK; this
  submission deviates deliberately because the assignment requires zero ongoing cost, and the
  deviation is documented in the PR.
- Language: TypeScript everywhere (Node 22 via nvm, pnpm, nx). No Python.
- Open data only. Sources that are paid (Assessor secured roll), blocked (BBB bulk, SOS
  BizFile) or unreachable (San José ArcGIS, HTTP 522 from both local and Cloudflare egress)
  are documented, not scraped around.
- All repository content in English.

## 3. Data sources

| Key | Source | Access | Yields | Refresh signal |
|---|---|---|---|---|
| `scc-parcels` | County of Santa Clara open data, dataset `ubcd-cewv` (Socrata) | `https://data.sccgov.org/resource/ubcd-cewv.json`, paged by `objectid`, 50k rows/page | 504,717 parcel polygons with APN, situs address, jurisdiction. No owner, no year built. | dataset `:updated_at` |
| `sj-permits-active` | City of San José open data (CKAN) | `buildingpermitsactive.csv` | 17,291 active permits | CKAN `last_modified` (daily 16:00) |
| `sj-permits-inspection` | same | `buildingpermitsunderinspection.csv` | 10,609 permits under inspection | same |
| `sj-permits-expired` | same | `buildingpermitsexpired.csv` | 75,802 expired permits | same |
| `sj-permits-30d` | same | `buildingpermits30.csv` | last 30 days (overlaps the above; used as change feed) | same |
| `cslb-c39` | CSLB Public Data Portal, list by county (Santa Clara, class C-39) | HTTPS form POST; best effort | License number, business name, status for roofing contractors | run date |

Permit CSV columns used: `Status, ASSESSORS_PARCEL_NUMBER, APPLICANT, OWNERNAME, CONTRACTOR,
FOLDERNUMBER, FOLDERNAME, SUBTYPEDESCRIPTION, WORKDESCRIPTION, PERMITAPPROVALS, ISSUEDATE,
FINALDATE, PERMITVALUATION, gx_location, FOLDERRSN`.

A permit is **roofing** when `WORKDESCRIPTION`, `SUBTYPEDESCRIPTION` or `FOLDERNAME` matches
`/\b(re-?roof|roof(ing)?|shingle)\b/i`. All permits are loaded; roofing is a flag.

Every stored record carries provenance: `source_key`, `source_url`, `source_version`
(dataset `:updated_at` or CKAN `last_modified`), `fetched_at`, `page_sha256` (hash of the raw
page/file the record came from) and `record_hash` (hash of the normalized record).

## 4. Data model (DuckDB; exported to Parquet)

- `properties` — `apn` (8-digit text, PK), `situs_address`, `situs_city`, `situs_zip`,
  `jurisdiction`, `lat`, `lon` (polygon bounding-box center), `tax_rate_area`, provenance.
- `permits` — `permit_number` (PK), `apn` (nullable FK), `status` (`active` /
  `under_inspection` / `expired`), `permit_state` (`open` / `expired_unfinaled` / `finaled`),
  `is_roofing`, `work_description`, `subtype`, `folder_name`, `approvals`, `issue_date`,
  `final_date`, `valuation`, `address`, `applicant`, `owner_name_raw`, `contractor_raw`,
  `contractor_id` (nullable FK), `days_open` (as-of run date for `open`; issue→final for
  `finaled`; issue→as-of for `expired_unfinaled`, flagged), provenance.
- `contractors` — `contractor_id` (hash of normalized company name), `company_name`,
  `contact_name`, `permit_count`, `roofing_permit_count`, `cslb_license_number`,
  `cslb_status`, `cslb_match_method` (`name` / null), `bbb_rating` (always null; no public
  source — kept in the contract so consumers do not invent it), provenance.
- `owners` — `apn`, `owner_name`, `observed_on` (permit issue date), `permit_number`,
  provenance. One row per permit observation; `latest_owner` view picks the newest.
- `roof_age` — `apn`, `roof_date`, `roof_age_years` (as-of run date), `anchor`
  (`final_date` / `approval_complete_issue_date`), `confidence` (`high` / `medium`),
  `permit_number`, provenance. Derived only from roofing permits with `FINALDATE`, or with
  `PERMITAPPROVALS` containing `Complete` (anchor = issue date). Parcels with no roofing
  permit have unknown roof age; there is no public year-built field.
- `runs` — `run_id`, `started_at`, `finished_at`, `as_of`, `status`, per-source
  `{source_version, fetched, inserted, updated, unchanged, removed}`, totals, `limitations[]`,
  `manifest_cid`, `previous_run_id`.
- `leads` view — roofing-relevant join used by consumers: property + latest roofing permit +
  contractor + roof age + latest owner.

Entity reconciliation: parcels by normalized APN; permits by `FOLDERNUMBER` across the four
CSVs (precedence `under_inspection` > `active` > `expired` when the same number appears in
several files); contractors by normalized company name (upper-cased, punctuation and legal
suffix stripped); permit→parcel by APN, unmatched permits kept with `apn = null`.

## 5. Pipeline runtime (nx app `pipeline`, Node CLI)

Commands (`pnpm nx run pipeline:<cmd>` or `pipeline <cmd>`):

1. `ingest` — for each source: fetch (streaming, retried), hash raw bytes, parse, normalize,
   upsert into `data/santa-clara.duckdb` by primary key with `record_hash` change detection;
   compute per-source deltas; derive `roof_age`, `days_open`, `contractors`, `owners`; write a
   `runs` row. A source whose `source_version` equals the previous run's is skipped as
   `unchanged` (idempotent re-run). `--window <days>` restricts permit ingestion to the
   last-30-days feed for cheap incremental refreshes.
2. `export` — write `exports/<run_id>/*.parquet` (one per table) plus `runs.json`,
   `coverage.json` (record counts, date ranges, jurisdiction coverage, limitations) and the
   DuckDB SQL examples used by the Explorer.
3. `publish` — build a UnixFS DAG of the export directory with `ipfs-car` (CIDv1, base32),
   write `<run_id>.car`, upload the CAR to Filebase (S3 API, `import=car`), confirm Filebase
   reports the same root CID, then write `manifest.json` with every object: `cid`, `name`,
   `size`, `codec` (`file` / `directory`), `sha256`, plus `car` entry, `run_id`, `previous_manifest_cid`.
   Previous CIDs are never mutated; the manifest is uploaded last and its CID is recorded in
   `runs`.
4. `verify` — fetch each manifest object from at least two gateways in a configurable list that
   excludes the pinning vendor (`dweb.link`, `ipfs.io`, `gateway.pinata.cloud`, `w3s.link`,
   `4everland`, `trustless-gateway.link`), with retry and backoff, compare size and SHA-256,
   and write `verification.json` (gateway, status, bytes, digest match, timestamp). Fails the
   run if fewer than two independent gateways serve every object.
5. `sync` — load the exported tables into Cloudflare D1 (the MCP snapshot) and record
   `manifest_cid` in D1 `snapshot`. Mirrors the kit's "MCP syncs the accepted snapshot; tools
   never fetch remote archives per request".
6. `run` — `ingest → export → publish → verify → sync`.

Run history lives in DuckDB, in `exports/<run_id>/runs.json` (published) and in
`docs/runs/<run_id>.json` committed to the repository so a third party can fetch any run by CID
after the environment is gone.

Scheduling: GitHub Actions workflow `ingest.yml` (cron daily after the San José 16:00 PT
refresh, plus `workflow_dispatch`) runs `pipeline run` and commits `docs/runs/*` back. Secrets:
Filebase keys, Cloudflare API token. Local runs use `.env`.

Performance notes to document: Socrata paging at 50k rows (~11 pages, ~2–3 min), San José
CSVs total ~36 MB, CSLB is slow and sometimes 503 — treated as best effort with the gap
recorded in `runs.limitations`.

## 6. Access layer

- **MCP server** (nx app `mcp-server`, Cloudflare Worker, Hono + `@modelcontextprotocol/sdk`
  Streamable HTTP at `/mcp`, plus the same handlers exposed as REST under `/api/*` for the
  Explorer and the CRM). Tools, all backed by D1 with bounding-box prefilter + haversine:
  `search_properties_in_radius`, `find_aged_roofs`, `find_open_roofing_permits`,
  `get_property`, `get_contractor`, `list_runs`, `get_manifest`. Every response includes
  `provenance` (source url, version, fetched_at) and the `manifest_cid` of the snapshot.
  Inputs validated with Zod.
- **Explorer** (nx app `explorer`, React + MUI + Vite on a Cloudflare Worker with static assets): run summary
  (sources, versions, counts, deltas, limitations), records by source, artifact manifest with
  CIDs and gateway links derived from CIDs, verification results, and a DuckDB-WASM SQL panel
  that reads the published Parquet straight from an IPFS gateway by CID (proves the data is
  queryable with no Oracle-hosted database). Pre-filled example queries: aged roofs in a
  radius, long-open roofing permits with contractor, properties by owner.
- **Agent demo**: the Explorer links to the CRM agent (separate repository). The MCP endpoint
  is exercised in the demo with an MCP client call.

## 7. Repository layout

```
apps/pipeline/        CLI (ingest, export, publish, verify, sync, run)
apps/mcp-server/      Cloudflare Worker (MCP + REST), wrangler.jsonc, D1 migrations
apps/explorer/        React + MUI + Vite, DuckDB-WASM panel
libs/domain/          Zod schemas, normalization, roof-age and permit-state rules (pure)
libs/sources/         Socrata, CKAN CSV, CSLB fetchers with provenance
docs/superpowers/     specs and plans
docs/runs/            committed run records (manifest CIDs, deltas, verification)
docs/sources.md       source catalog, constraints, gaps
.github/workflows/    ci.yml (lint, typecheck, test, build), ingest.yml (scheduled run)
CLAUDE.md             conventions for agents working in this repo
```

## 8. Error handling

- Fetch failures: 3 retries with exponential backoff; a failed source marks the run
  `partial` with the error in `limitations`, other sources proceed.
- Hash mismatch between a stored page and a replayed page aborts that source.
- Publish is all-or-nothing per run: if Filebase does not report our root CID, nothing is
  recorded as published.
- Verify failure keeps the run marked `published_unverified` with the gateway log; it never
  deletes anything.

## 9. Testing

- Unit (Vitest): APN normalization, CSV row mapping, roofing classifier, permit state and
  `days_open`, roof-age derivation, contractor name split and normalization, haversine and
  bounding box, manifest building, CID computation against a fixture CAR.
- Integration: ingest two fixture snapshots (day 1, day 2) into an in-memory DuckDB and assert
  deltas, idempotent re-run, run history; publish with a fake uploader; verify with a fake
  gateway.
- Worker: Vitest with `@cloudflare/vitest-pool-workers` against a local D1 for each tool.
- CI runs lint, typecheck, unit and integration tests, and builds all apps.

## 10. Out of scope (documented gaps)

Other 15 permit jurisdictions, Assessor roll (owner mailing address, transfer dates, year
built), BBB ratings, SOS business registry, Atlas registration (requires a code-owner merge),
IPNS (CID history is the pointer), per-parcel Assessor PDF scraping (terms prohibit resale).

## 11. Decisions

- CKAN CSVs for San José permits instead of the San José ArcGIS service, which was unreachable.
- The MCP server reads a D1 snapshot rather than querying DuckDB or IPFS at request time.
- D1 sync is incremental, with a bootstrap mode, because of the free-tier write budget (100,000 rows/day).
- Days open is computed at query time, not stored as a fixed value for the API.
- The Explorer is a Cloudflare Worker with static assets instead of Pages.
- CSLB contractor licenses are deferred.
