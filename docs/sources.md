# Source catalog

Facts marked **(observed 2026-10-07)** were observed on that date while building the pipeline;
they describe the sources at that moment and may change. Source keys match the `sources` map in
`docs/runs/*.json`.

## Sources used

| Key | Owner | URL | Format | Refresh signal | Size observed | Constraints |
|---|---|---|---|---|---|---|
| `scc-parcels` | County of Santa Clara open data (Socrata dataset `ubcd-cewv`) | `https://data.sccgov.org/resource/ubcd-cewv.json` | JSON, parcel polygons (`the_geom`) with APN, situs address parts, jurisdiction, tax rate area | Dataset-level `:updated_at` (read with `$select=max(:updated_at)`), not row-level | 494,841 parcels loaded in run 2; `:updated_at` was 2026-08-26T16:22:37Z (observed) | Paged with `$order=objectid&$limit=10000&$offset=n` (pipeline page size 10,000). No owner, no year built. Change detection is dataset-level only: a changed timestamp means a full re-read. Coordinates are the bounding-box center of the polygon, not a rooftop point. The design spec records 504,717 polygons at planning time; run 2 loaded 494,841 (rows without a normalizable APN are skipped and counted; the 9,876 difference was not itemized). Run 1 hit a parcels page read failure and finished `partial` (observed). |
| `sj-permits-active` | City of San José open data (CKAN, `data.sanjoseca.gov`) | package `active-building-permits`, resource `buildingpermitsactive.csv` | CSV | CKAN resource `last_modified` (daily, about 16:00 PT) | 17,291 rows (observed) | Covers the City of San José only. |
| `sj-permits-under_inspection` | same | package `building-permits-under-inspection`, `buildingpermitsunderinspection.csv` | CSV | same | 10,609 rows (observed) | same |
| `sj-permits-expired` | same | package `expired-building-permits`, `buildingpermitsexpired.csv` | CSV | same | 75,802 rows (observed) | same |
| `sj-permits-last_30_days` | same | package `last-30-days-building-permits`, `buildingpermits30.csv` | CSV | same | not recorded in run 2 | Overlaps the other three; defined in `libs/sources/src/ckan-permits.ts` for windowed refreshes. |

Exact download URLs are in `CKAN_PERMIT_RESOURCES` in `libs/sources/src/ckan-permits.ts`;
`last_modified` comes from `https://data.sanjoseca.gov/api/3/action/package_show?id=<package>`.

Run 2 totals (`docs/runs/2026-10-07T17-10-54Z.json`): 494,841 properties, 93,093 permits (63,853
matched to a parcel by APN), 7,751 roofing permits, 8,920 contractors, 77,359 owner observations,
7,151 roof-age rows. Roofing permits by state: expired_unfinaled 6,707, open 1,017, finaled 27.
Roof age of at least 15 years: 2,021 parcels, 962 of them within 5 miles of downtown San José.

Every stored record carries `source_key`, `source_url`, `source_version`, `fetched_at`,
`page_sha256` and `record_hash`. Raw pages and files are kept under `data/raw/<run_id>/`
(not committed).

## Sources investigated and not used

| Source | What was found | Why not used |
|---|---|---|
| San José ArcGIS permit service (`geo.sanjoseca.gov`) | Returned HTTP 522 from both local and Cloudflare egress (observed 2026-10-07) | Unreachable; the CKAN CSVs carry the same permit records and are used instead. |
| County Assessor secured roll (MF901B) | Sold for $495 | Paid. It would supply owner mailing address, transfer date and year built, none of which are available from free sources. |
| County Assessor per-parcel PDFs | Per-parcel lookup | Terms prohibit resale of the data; not scraped. |
| BBB | No bulk download or API for ratings | `bbb_rating` is kept in the data contract and is always null. |
| California Secretary of State BizFile | Behind Incapsula bot protection | Not scraped around; business registry records are not loaded. |
| CSLB Public Data Portal | `ListByCounty` answered HTTP 200 from Cloudflare (US) egress and 503 or timeouts from the local machine (observed 2026-10-07) | Contractor license matching is not implemented in this milestone (the work was deferred). The `contractors` table has `cslb_*` columns that stay empty. Contractors come from permit records only, grouped by normalized company name. |

## Uncovered permit jurisdictions

Permits cover the City of San José only. The 15 other jurisdictions in Santa Clara County are
catalogued from public portal inspection (permit portals vary: Accela, iWorQ, Tyler EnerGov and
others). Each needs its own adapter, and none exposes a bulk open-data feed comparable to San
José's CKAN CSVs.

1. Campbell
2. Cupertino
3. Gilroy
4. Los Altos
5. Los Altos Hills
6. Los Gatos
7. Milpitas
8. Monte Sereno
9. Morgan Hill
10. Mountain View
11. Palo Alto
12. Santa Clara (city)
13. Saratoga
14. Sunnyvale
15. Unincorporated Santa Clara County

Note: `days_open` in `leads.parquet` is computed as of the run date for non-finaled permits; the API computes it as of today.
