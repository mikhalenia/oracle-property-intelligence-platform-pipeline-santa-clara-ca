# Acceptance criteria traceability

Every bullet of the README "Acceptance Criteria" and every step of the "Demo Transcript", with a
strict status and the evidence for it. Statuses: `met`, `partial`, `gap`. Figures are from run 2
(`2026-10-07T17-10-54Z`, record in `docs/runs/2026-10-07T17-10-54Z.json`).

Shorthand used in the Evidence column:

- `API` = `https://scc-pipeline-api.mikhalenia-a.workers.dev`
- `EXPLORER` = `https://scc-explorer.mikhalenia-a.workers.dev`
- `RUN2` = `docs/runs/2026-10-07T17-10-54Z.json`
- Manifest CID `bafybeidav5d5sigbbrvfhaexjxa6nqszyfmcpscyhqpnuv65hribw7y4jq`; snapshot root `bafybeict6ibbchgt3ymi7v4re7354kfvwnryuoqpa4bjfa3moicfeoswiu`; CAR `bafybeic2s2oiuq5edcuj52e2lhgxmms442pk56fqtzg746c2oun5quo2b4`

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| **Geography and coverage** | | | |
| 1 | Target Santa Clara County, CA as the default and primary county | met | `manifest.county`/`fips` = Santa Clara / 06085 in `RUN2`; `coverage.json` in the snapshot; `docs/sources.md` |
| **Data loading** | | | |
| 2 | Run the pipeline until all available county data is uploaded | partial | Parcels: 494,841 loaded (`RUN2` `sources.scc-parcels`). Permits: San José only; 15 jurisdictions catalogued, not loaded (`docs/sources.md`, "Uncovered permit jurisdictions"). Paid or blocked sources not loaded (`docs/limitations.md`) |
| 3 | Load available property records | met | 494,841 properties (`RUN2` `totals.properties`); `properties.parquet` CID `bafybeifpla4tepbcnpod7onumf7aqrzhjocxp7eucfzho4pdowirlafome`; `GET API/api/properties/:apn` |
| 4 | Load available permit records, emphasis on roofing permits | partial | 93,093 permits, 7,751 roofing (`RUN2` `totals`), `permits.parquet`; City of San José only (`docs/limitations.md`, "Permits across the county") |
| 5 | Preserve permit status, open/close dates, duration-open signals | met | Permit state (`open`, `expired_unfinaled`, `finaled`) and years open in `GET API/api/leads/open-permits`; tool `find_open_roofing_permits`; rules in `libs/domain` |
| 6 | Load available ownership records | partial | 77,359 owner observations taken from permit records (`RUN2` `totals.owners`, `owners.parquet`); no Assessor roll (paid); most parcels have no owner (`docs/limitations.md`) |
| 7 | Load available contractor records | partial | 8,920 contractors from permit fields, reconciled by normalized name (`RUN2` `totals.contractors`, `GET API/api/contractors/:id`, tool `get_contractor`); not matched to CSLB licenses (`docs/sources.md`, "Sources investigated and not used") |
| 8 | Load available BBB / contractor rating scores where publicly available | gap | No public bulk source; `bbb_rating` always null (`docs/limitations.md`, "BBB rating scores"; `apps/mcp-server/src/mappers.ts` `bbbRating: null`) |
| 9 | Load available business records | gap | California SOS BizFile is bot-protected and not scraped (`docs/limitations.md`, "Business records"); no business table |
| 10 | Load location and coordinate data for radius queries | met | Parcel coordinates (bounding-box center of the polygon, not a rooftop point) in `properties.parquet`; `GET API/api/properties/radius`; tool `search_properties_in_radius`; caveat in `docs/limitations.md` |
| 11 | Capture roof age or best-available proxy, queryable by threshold (default 15 years) | partial | Roof age from roofing permits only: 7,151 roof-age rows for 494,841 parcels; 2,021 parcels at 15 years or more (`docs/limitations.md`); `roof_age.parquet`; `GET API/api/leads/aged-roofs?minRoofAgeYears=15`; no year built |
| 12 | Reconcile duplicate entities across all uploaded datasets | partial | APN normalization, permit-number dedupe, contractor-name normalization (`libs/domain`; 8,920 contractors); 63,853 of 93,093 permits matched to a parcel by APN, the rest keep a null APN; no cross-dataset owner or business reconciliation |
| 13 | Preserve source provenance for uploaded records | met | Every record carries `source_key`, `source_url`, `source_version`, `fetched_at`, `page_sha256`, `record_hash` (`docs/sources.md`); provenance in API responses (`GET API/api/properties/:apn`) |
| 14 | Continuous/incremental design: ongoing ingestion, change detection, idempotent steps | met | `record_hash` upsert with inserted/updated/unchanged/removed counts per source (`RUN2` `sources`); permit sources skipped when `sourceVersion` is unchanged (`skipped: true`); `.github/workflows/ingest.yml` (daily 00:30 UTC and `workflow_dispatch`) running `pnpm nx run pipeline:cli -- run` (`apps/pipeline/src/commands/run.ts`) |
| 15 | Visible history of runs (timestamps, sources, counts, deltas, limitations) | met | `GET API/api/runs` (runs 1 and 2); `EXPLORER` Runs page; `docs/runs/*.json`; `runs.json` artifact CID `bafkreifingna3clf26acxe3djo4mom5s7you4ans2ehfndn3gb2qgytr4a` |
| 16 | Demonstrate data continues to be ingested and published over time | partial | Two runs exist (run 1 partial and unpublished, run 2 complete and published). Only one published manifest (`previousManifestCid: null`); a second published manifest is planned for the next scheduled run |
| **Infrastructure and access** | | | |
| 17 | Optimize pipeline performance where feasible | partial | 10,000-row Socrata pages; unchanged permit sources skipped by version; D1 snapshot sync being made incremental after the D1 free-tier write limit was hit on 2026-10-07 (`apps/pipeline/src/sync`); the parcel read stays a full re-read (`docs/limitations.md`) |
| 18 | Identify slow source sites or constrained data sources | met | `docs/limitations.md`, "Source speed and constraints"; `docs/sources.md` |
| 19 | Document pipeline speed limitations and source constraints | met | `docs/limitations.md` (run 2 ingest 17:10:54Z to 17:15:02Z; 522/503 sources; gateway behaviour) |
| 20 | Infrastructure with no ongoing Oracle cost by default | met | Cloudflare Workers, D1 and static assets, Filebase pinning, GitHub Actions; nothing always-on (`README.md` "Architecture"; design spec section 2) |
| 21 | Use IPFS for decentralized storage of eligible artifacts | met | 10 artifacts plus CAR in the manifest of `RUN2`; snapshot root `bafybeict6ibbchgt3ymi7v4re7354kfvwnryuoqpa4bjfa3moicfeoswiu` |
| 22 | Use DuckDB for local or portable analytical querying | met | Local `data/santa-clara.duckdb`; Parquet exports; `EXPLORER` SQL page (DuckDB-WASM over the published Parquet); `apps/pipeline/src/sql-examples.ts` |
| 23 | Structure the database to support MCP access | met | Same data model for REST and MCP over D1 (`apps/mcp-server/src/tools.ts`, `mappers.ts`) |
| 24 | Enable agent access to query the database | met | `POST API/mcp` (Streamable HTTP), seven tools: `search_properties_in_radius`, `find_aged_roofs`, `find_open_roofing_permits`, `get_property`, `get_contractor`, `list_runs`, `get_manifest` |
| 25 | Provide a UI for exploring the uploaded data | met | `EXPLORER` pages Runs, Sources, Manifest, SQL (`apps/explorer/src/pages/*.tsx`) |
| **IPFS publication** | | | |
| 26 | CIDs are the durable identity; vendor URLs are not the source of truth | met | Manifest records CIDs with `gatewayUrlTemplate` `https://{gateway}/ipfs/{cid}` (`RUN2` `manifest`); `GET API/api/manifest` |
| 27 | Prefer CIDv1 (base32) for every published object | met | All 11 manifest CIDs and the manifest CID start with `bafy`/`bafk` (`RUN2` `manifest.artifacts`, `manifest.car`) |
| 28 | Published bytes retrievable from the public IPFS network | met | Served by `gateway.pinata.cloud` and `ipfs.raribleuserdata.com` for every artifact (`RUN2` `verification`); pinned on Filebase |
| 29 | Machine-readable manifest per run with cid, name, size, codec, digest (optional origins) | met | `RUN2` `manifest` (schema `scc-manifest/1`: `cid`, `name`, `path`, `size`, `codec`, `sha256`; no `origins`, which are optional); manifest CID above |
| 30 | If IPNS is used, record the name and the resolved CID | met | IPNS not used by choice (`manifest.ipns: null`; `docs/limitations.md`, "IPNS"); the CID history is the pointer, so the condition does not apply |
| 31 | On republish keep prior CIDs immutable; run history retains previous CIDs | partial | Mechanism: `previousManifestCid` in each manifest and `docs/runs/<run_id>.json` never rewritten. Only one published run so far, so no second CID exists yet |
| 32 | CAR of the DAG for directory artifacts | met | CAR `bafybeic2s2oiuq5edcuj52e2lhgxmms442pk56fqtzg746c2oun5quo2b4`, 41,904,022 bytes, root = snapshot root (`RUN2` `manifest.car`) |
| 33 | Each CID fetched from at least two independent public gateways, bytes match size/digest | met | `RUN2` `verification` (`ok: true`, `minIndependent: 2`, `sha256Match: true`): `gateway.pinata.cloud` and `ipfs.raribleuserdata.com` on all 11 objects; `ipfs.ssi.eecc.de` intermittent. `ipfs.io` and `dweb.link` return 429/522 to non-browser clients (`docs/limitations.md`) |
| 34 | Manifest (and CARs) in the repository or demo packet | partial | Manifest in `RUN2`. The CAR (42 MB) is not committed; it is fetchable by CID from the gateways above |
| **Roofing CRM-supporting queries** | | | |
| 35 | Radius-based property identification from coordinates | met | `GET API/api/properties/radius?lat=37.3382&lon=-121.8863&radiusMiles=5`; tool `search_properties_in_radius` |
| 36 | Properties with roofs older than 15 years (or configurable threshold) | partial | `GET API/api/leads/aged-roofs?minRoofAgeYears=15`; tool `find_aged_roofs`; 962 parcels within 5 miles of downtown San José; only parcels with a roofing permit have a roof age (7,151 of 494,841) |
| 37 | Properties with open roofing permits, including long-open ones | met | `GET API/api/leads/open-permits?state=any&minOpenYears=5`; tool `find_open_roofing_permits`; San José permits only (1,017 open, 6,707 expired without final) |
| 38 | Permit details with contractor name and BBB rating where available | partial | Permit state, years open and contractor name returned; BBB always null (`docs/limitations.md`); CSLB fields empty |
| 39 | Properties with no ownership exchange in more than 10 years | gap | No transfer dates available (Assessor roll is paid); `docs/limitations.md` first row |
| 40 | Properties with regional or out-of-area owners | gap | No owner mailing address available; `docs/limitations.md` first row |
| 41 | Return source-backed answers where source data is available | met | Every API/MCP response includes the snapshot (`manifest_cid`) and per-record provenance (`docs/demo-script.md` step 10) |
| **Demonstration** | | | |
| 42 | Demonstrate the dataset through the UI | met | `EXPLORER`; click path in `docs/demo-script.md` steps 1-8. The recorded demo video is pending |
| 43 | Demonstrate the dataset through an agent query for roofing lead discovery | partial | `POST API/mcp` tools `find_aged_roofs`, `find_open_roofing_permits` and the prompts in `docs/demo-script.md` step 9; no recorded agent session yet |
| 44 | Demonstrate Oracle can operate without carrying infrastructure cost | met | Serverless-only architecture (`README.md`); `.github/workflows/ingest.yml` schedule; design spec section 2 |
| 45 | Demonstrate public CID-addressed publication with manifest and independent gateway retrieval | met | `API/api/manifest`; `RUN2` `verification`; `docs/demo-script.md` step 5 |
| 46 | Confirm the candidate fulfilled both Oracle and builder responsibilities | partial | Pipeline, publication, scheduling and access are built and live; the explicit statement is for the demo video, which is pending |
| 47 | Pass the demo using real uploaded Santa Clara County records | partial | Real records (494,841 County parcels, 93,093 San José permits) are live; the demo recording is pending and coverage gaps above apply |

## Demo Transcript

| # | Step | Status | Evidence |
|---|---|---|---|
| T1 | Presenter introduction: dataset loaded, queryable through DuckDB, on IPFS, UI and agent answer roofing questions | partial | True for the loaded scope only (San José permits, no owner transfer or BBB data); `docs/demo-script.md` step 0 and `docs/limitations.md` |
| T2 | Open the pipeline run summary (completed run, sources, coverage, counts, timestamps, limitations) | met | `EXPLORER` Runs page; `GET API/api/runs`; `RUN2` `limitations` (four strings) |
| T3 | Show total uploaded records by source (property, permit, ownership, contractor with BBB, business, coordinates, with timestamps and provenance) | partial | Runs/Sources pages and `RUN2` `sources` and `totals`: properties, permits, owners, contractors, roof age, coordinates. No business records; BBB null |
| T4 | Open the DuckDB-backed query layer | met | `EXPLORER` SQL page (DuckDB-WASM reads the Parquet by CID in the browser); no Oracle-hosted database |
| T5 | Show the published artifact manifest | met | `GET API/api/manifest`; `EXPLORER` Manifest page; manifest CID above; no IPNS used |
| T6 | Retrieve one artifact from a public gateway, then from a second independent one | met | `RUN2` `verification`; `gateway.pinata.cloud` and `ipfs.raribleuserdata.com`; commands in `docs/demo-script.md` step 5 |
| T7 | Show a later incremental publish produced a new CID without mutating the previous one | partial | `previousManifestCid` and the scheduled workflow exist; only run 2 is published, so no second CID can be shown yet (planned for the next scheduled run) |
| T8 | UI: properties within a sample radius with roofs older than 15 years (roof-age basis, coordinates, provenance) | met | Aged-roof example in `EXPLORER` (SQL page); `GET API/api/leads/aged-roofs?lat=37.3382&lon=-121.8863&radiusMiles=5&minRoofAgeYears=15` (962 parcels, anchor and confidence per row) |
| T9 | UI: open roofing permits in the area, longest open first, with contractor and BBB where available | partial | `GET API/api/leads/open-permits?lat=37.3382&lon=-121.8863&radiusMiles=5&state=any&minOpenYears=5`; contractor shown, BBB null |
| T10 | Agent prompt: properties within five miles of [city] with roofs older than 15 years | met | Tool `find_aged_roofs` via `POST API/mcp` (`docs/demo-script.md` step 9); the agent session itself is not yet recorded |
| T11 | Agent prompt: nearby open roofing permits open for many years and the listed contractor | partial | Tool `find_open_roofing_permits`; BBB missing is stated as an assumption; the agent session is not yet recorded |
| T12 | Show the system is MCP-ready | met | `POST API/mcp` `tools/list` and `tools/call` (`docs/demo-script.md` step 10) |

## Counts

Over the 47 acceptance criteria plus the 12 transcript steps (59 rows):

| Section | met | partial | gap |
|---|---|---|---|
| Acceptance criteria (47) | 28 | 15 | 4 |
| Demo transcript steps (12) | 7 | 5 | 0 |
| Total (59) | 35 | 20 | 4 |

Gaps: BBB ratings (8), business records (9), ownership transfer over 10 years (39), regional or
out-of-area owners (40). All four are documented in `docs/limitations.md`.
