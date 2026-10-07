# Oracle Property Intelligence Platform Pipeline - Santa Clara County, CA

## Context

This repository is the **data gathering and ingestion pipeline** that supplies the [Roofing CRM & Lead Identification UI](https://github.com/prismteam-ai/roofing-crm). The CRM helps roofing companies explore properties in their service area, identify aging roofs and open roofing permits, and turn those signals into leads. This pipeline story covers collecting, loading, reconciling, and exposing the underlying property and permit datasets; the CRM UI/workflow itself is out of scope here.

The Oracle ingestion pipeline has been started, but the full **Santa Clara County, CA** dataset has not been completely uploaded, reconciled, or demonstrated. The infrastructure must be designed so Oracle does not carry ongoing infrastructure cost by default. For this candidate exercise, the candidate acts as both Oracle and builder: they are responsible for completing the pipeline and proving the low-cost infrastructure approach.

The pipeline must be continuous and incremental (ongoing ingestion of new and changed records over time) and must publish eligible data artifacts to Elephant IPFS (the Elephant protocol’s decentralized storage layer, following Lexicon / elephant-cli / Filebase+IPNS conventions used by the Elephant oracle skills).

Published artifacts must remain independently retrievable from the public IPFS network after the candidate’s local environment, demo session, and any single pinning vendor are gone. **Content identifiers (CIDs) are the durable identity of each artifact.** A vendor HTTP gateway URL is a convenience locator, not the artifact.

In addition to standard property intelligence, the pipeline must surface signals relevant to **roofing lead generation**, including roof age, open roofing permits (especially long-open permits), contractor identity, BBB rating scores where available, ownership/contact fields where available, and accurate property coordinates for radius-based search.

## Description

Complete the Oracle pipeline by loading all available Santa Clara County, CA property, permit, ownership, business, contractor, location, and public-source data into an MCP-ready database. Use IPFS and DuckDB to minimize Oracle-hosted infrastructure costs while enabling UI and agent access to answer property intelligence questions that support the roofing CRM—especially aged-roof and open-permit lead discovery within a map radius.

The pipeline must demonstrate that data is ingested on an ongoing basis (not a one-shot bulk load): support incremental / windowed refreshes, preserve run history with record deltas and timestamps, and re-publish updated artifacts to Elephant IPFS as **new immutable CIDs** (do not mutate a previously published CID).

## Acceptance Criteria

### Geography & coverage
- Target **Santa Clara County, CA** as the default and primary county for ingestion and demos.

### Data loading
- Run the Oracle pipeline until all available county data is uploaded.
- Load available property records into the database.
- Load available permit records into the database, with emphasis on **roofing-related permits**.
- Preserve permit status, open/close dates (or equivalent), and duration-open signals so long-open permits can be identified.
- Load available ownership records into the database.
- Load available contractor records into the database.
- Load available BBB / contractor rating scores where publicly available.
- Load available business records into the database.
- Load available location and coordinate data into the database (required for GPS/pin-drop radius queries in the CRM).
- Capture roof age or best-available proxies (e.g., year built, last roofing permit/completion date) so properties with roofs older than a configurable threshold (default suggestion: **15 years**) can be queried.
- Reconcile duplicate entities across all uploaded datasets.
- Preserve source provenance for uploaded records.
- Design and implement the pipeline as continuous / incremental:
  - Support ongoing ingestion of new and changed records (scheduled or on-demand refreshes, change detection or bounded windows, idempotent steps).
  - Maintain a visible history of pipeline runs (timestamps, source list, record counts, deltas, any source limitations).
  - Demonstrate that data continues to be ingested and published over time (multiple runs or simulated ongoing updates).

### Infrastructure & access
- Optimize pipeline performance where feasible.
- Identify slow source sites or constrained data sources.
- Document pipeline speed limitations and source constraints.
- Design the infrastructure so Oracle does not carry ongoing infrastructure cost by default.
- Use IPFS for decentralized storage of eligible dataset artifacts.
- Use DuckDB for local or portable analytical querying.
- Structure the database to support MCP access.
- Enable agent access to query the database.
- Provide a UI for exploring the uploaded data.

### IPFS publication
- Treat IPFS **CIDs** as the durable identity of published artifacts. Do not treat a vendor-specific HTTP URL as the source of truth.
- Prefer **CIDv1** (base32) for every published object.
- Keep published bytes **retrievable from the public IPFS network**, not only from a private node, authenticated gateway, vendor dashboard, or laptop that is running during the demo.
- Publish a machine-readable **artifact manifest** (JSON) for each pipeline run. Include every eligible object (query table, coverage, indexes, sample extracts, and any directory roots) with at least:
  - `cid`
  - logical `name` / path
  - `size` in bytes
  - IPFS codec (`file` vs `directory`)
  - content digest (e.g. SHA-256 of the raw bytes, or equivalent)
  - optional provider `origins` (multiaddrs) if a candidate-operated node is still serving the blocks
- If IPNS is used, record both the IPNS name and the **resolved CID** for that run. IPNS is a pointer; the CID is the snapshot.
- On incremental republish, keep prior CIDs immutable. New data produces a new CID. Run history must retain previous CIDs.
- For directory artifacts, also publish a **CAR** of the DAG rooted at that CID so the snapshot can be imported by any IPFS node without re-encoding.
- Demonstrate that each listed CID can be fetched from **at least two independent public gateways** that this environment does not operate (for example `https://ipfs.io/ipfs/<cid>` and `https://dweb.link/ipfs/<cid>`), and that the retrieved bytes match the manifest size/digest.
- Include the artifact manifest (and CARs, if any) in the repository or demo packet so a third party can fetch the dataset by CID after the candidate environment is gone.

### Roofing CRM–supporting queries
- Support radius-based property identification using coordinates (around a GPS point or map pin).
- Support questions about properties with roofs older than 15 years (or a configurable age threshold).
- Support questions about properties with **open roofing permits**, including those that have remained open for many years.
- Support returning permit details with contractor name and BBB rating score where available.
- Support questions about properties that have not exchanged ownership in more than 10 years.
- Support questions about properties with regional (or out-of-area) owners.
- Return source-backed answers where source data is available.

### Demonstration
- Demonstrate the uploaded dataset through the UI.
- Demonstrate the uploaded dataset through an agent query aligned to roofing lead discovery.
- Demonstrate that Oracle can operate without carrying the infrastructure cost.
- Demonstrate public, CID-addressed IPFS publication using the artifact manifest and independent gateway retrieval (not a private-only locator).
- Confirm the candidate fulfilled both Oracle and builder responsibilities for this milestone.
- Pass the demo using real uploaded Santa Clara County records.

## Demo Transcript
- Presenter: “I will demonstrate that the Oracle pipeline has loaded the available dataset for Santa Clara County, California, that the data is queryable through DuckDB, that eligible artifacts are stored on IPFS as content-addressed snapshots, and that both the UI and agent can answer property intelligence questions that support roofing lead generation.”
- Presenter: “First, I am opening the pipeline run summary.”
  - Expected Result: The system displays the completed pipeline run, source list, county coverage, record counts, timestamps, and any documented source limitations.
- Presenter: “Show the total uploaded records by source.”
  - Expected Result: The system shows uploaded property, permit, ownership, contractor (with BBB rating where available), business, and coordinate records with collection timestamps and provenance.
- Presenter: “Now I am opening the DuckDB-backed query layer.”
  - Expected Result: The system confirms that the loaded data is available for structured querying without requiring Oracle-hosted database infrastructure.
- Presenter: “Show the published artifact manifest for this run.”
  - Expected Result: A JSON (or equivalent) listing every eligible artifact with CID, size, logical name, codec, and digest. Gateway URLs, if shown, are derived from those CIDs. An IPNS name, if used, is shown together with the resolved CID.
- Presenter: “Retrieve one published artifact by CID from a public gateway that this environment does not operate, then again from a second independent public gateway.”
  - Expected Result: Both fetches succeed and the bytes match the manifest size/digest. Serving the object only from a private, local, or authenticated gateway is a fail.
- Presenter: “Show that a later incremental publish produced a new CID without mutating the previous one.”
  - Expected Result: The prior CID still resolves; the new run has a distinct CID; IPNS (if used) now points at the new CID; both CIDs appear in run history. A CAR is available for any directory root.
- Presenter: “Using the UI, show properties within a sample radius that have roofs older than 15 years.”
  - Expected Result: Matching properties are returned with roof-age basis, coordinates, and source provenance.
- Presenter: “Show properties in that area with open roofing permits, prioritizing permits that have remained open for many years, including contractor and BBB rating where available.”
  - Expected Result: Results include permit status/open duration, contractor identity, BBB score when present, and clear source backing.
- Presenter: “Now I am asking the same type of questions through the agent.”
  - Agent Prompt: “Which properties in Santa Clara County within five miles of [city xyz] have roofs older than 15 years?”
    - Expected Result: The agent returns matching properties, explains the reasoning, and includes source-backed evidence.
  - Agent Prompt: “Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?”
    - Expected Result: The agent returns a filtered list with permit age/open duration, contractor details, BBB rating when available, and clearly identifies any assumptions or missing data.
- Presenter: “Finally, I will show that the system is MCP-ready.”
  - Expected Result: The system demonstrates an MCP-ready interface or documented MCP-compatible query structure that agents and the roofing CRM can use without changing the data model.

## Out of Scope
- Roofing CRM UI, map pin/GPS interaction design, and lead outreach workflows (covered in [roofing-crm](https://github.com/prismteam-ai/roofing-crm)).
- Live outbound messaging to property owners.

## Reference
- [Roofing CRM & Lead Identification UI](https://github.com/prismteam-ai/roofing-crm)
- [Soofi XYZ Team Kit](https://github.com/soofi-xyz/soofi-xyz-team-kit)
- [Elephant Oracle Skills](https://github.com/elephant-xyz/skills)

## Candidate implementation

### Live URLs

- REST and MCP API (Cloudflare Worker): https://scc-pipeline-api.mikhalenia-a.workers.dev (`/api/health`, `/api/runs`, `/api/manifest`, `/api/properties/radius`, `/api/leads/aged-roofs`, `/api/leads/open-permits`, `/api/properties/:apn`, `/api/contractors/:id`, `POST /mcp`)
- Explorer UI (Cloudflare Worker with static assets): https://scc-explorer.mikhalenia-a.workers.dev

### What was built

An nx + pnpm + TypeScript pipeline that loads Santa Clara County parcels (County open data, Socrata) and City of San José building permits (CKAN CSVs) into DuckDB with per-record provenance and hash-based change detection, derives roofing flags, permit states, contractors, observed owners and roof age from roofing permits, exports Parquet, publishes the export as a CIDv1 UnixFS directory plus CAR to Filebase, verifies retrieval from public gateways, and syncs a snapshot to Cloudflare D1. A Worker serves the snapshot over REST and MCP (seven tools), and an Explorer app shows runs, leads (aged roofs and open or stalled permits from the REST API), sources, the manifest with verification results, and a DuckDB-WASM SQL panel. Three runs have been executed (two published). Run 1 (`2026-10-07T17-05-59Z`, partial: permits loaded, parcels failed) is visible only via `GET /api/runs` and in the `runs.json` artifact published inside the snapshot; run 2 (`2026-10-07T17-10-54Z`) is the first published run and run 3 (`2026-10-07T18-31-50Z`, a forced incremental republish with unchanged sources) the second; both records are in `docs/runs/`. Coverage is limited: permits are San José only, and owner, year built and BBB data are not available from free sources. See `docs/limitations.md`.

### Architecture

- `apps/pipeline`: CLI with `ingest`, `export`, `publish`, `verify`, `sync`, and `run`, the chained command (`ingest → export → publish → verify → sync`, stopping at the first failure). `sync` is incremental by default (only changed rows are written to D1; designed to stay within the free tier (100k row writes/day); the account currently runs on Workers Paid), `sync --full` rewrites everything, and `sync --bootstrap-state --run <id>` adopts an existing D1 snapshot without writes. An implicit full sync over an existing D1 snapshot is refused (the job fails and names the bootstrap command). `ingest.yml` therefore runs incremental syncs. Permit CSVs are downloaded and parsed every run; only the upsert is skipped when `last_modified` is unchanged. `publish` skips a run whose sources were all unchanged (`--force` overrides; `run --force` passes it through), since each publish stores about 84 MB
- `libs/sources`: Socrata and CKAN fetchers that attach provenance (source key, URL, version, fetch time, page SHA-256, record hash)
- `libs/domain`: pure rules (APN normalization, roofing classifier, permit state, roof age, contractor names, geo)
- `apps/mcp-server`: Cloudflare Worker (Hono, MCP Streamable HTTP at `/mcp`, same handlers as REST) over D1
- `apps/explorer`: React + MUI + Vite on Cloudflare (Worker with static assets), DuckDB-WASM reading published Parquet by CID The SQL page runs queries in the browser's local in-memory DuckDB copy; nothing is sent to a server or saved.
- Storage: DuckDB locally; Parquet and CAR on IPFS via Filebase; D1 holds the served snapshot
- Scheduling: `.github/workflows/ingest.yml`, daily at 00:30 UTC (after San José's 16:00 PT refresh) and on demand

Deviation from the team kit's Golden Path: Cloudflare (Workers, D1, static assets) instead of AWS/CDK, because the assignment requires zero idle cost for Oracle. Everything is serverless and nothing runs always-on.

### Reproduce locally

```sh
nvm use
pnpm install
cp .env.example .env   # fill FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY, FILEBASE_BUCKET, CLOUDFLARE_ACCOUNT_ID
pnpm nx run pipeline:cli -- ingest
pnpm nx run pipeline:cli -- export
pnpm nx run pipeline:cli -- publish
pnpm nx run pipeline:cli -- verify
pnpm nx run pipeline:cli -- sync    # needs wrangler authenticated (CLOUDFLARE_API_TOKEN)
pnpm check                           # lint, typecheck, test, build for every project
```

`ingest` and `export` need no secrets. `publish` needs the Filebase variables; `sync` needs Cloudflare credentials.

### Scheduled ingestion

`ingest.yml` runs `pipeline run` daily and on `workflow_dispatch` (one run at a time, 90 minute timeout), caches `data/` (the DuckDB file and the D1 sync marker, not raw downloads) between runs, saves the cache and commits new `docs/runs/*.json` back to the repository even when a step fails, and does not republish a day whose sources are all unchanged. Repository secrets required: `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (the Cloudflare pair is used only by `sync`).

Seeding the Actions cache (needed once, the workflow fails fast without it): run the pipeline locally so `data/santa-clara.duckdb` and `data/d1-sync-state.json` exist
(`pipeline sync --bootstrap-state --run <id>` if D1 already holds that run), then upload `data/` (minus `data/raw`) under a `pipeline-data-` key via `actions/cache`.
Alternatively start the first run with `workflow_dispatch` input `bootstrap=true`; the `force=true` input passes `--force` to `run`.

### Where the CIDs are

Each run writes `docs/runs/<run_id>.json` with the run record, manifest CID, the manifest (every artifact: `cid`, `name`, `size`, `codec`, `sha256`) and verification results. Published CIDs are immutable and past records are not rewritten. Run `2026-10-07T17-10-54Z` (complete): manifest `bafybeidav5d5sigbbrvfhaexjxa6nqszyfmcpscyhqpnuv65hribw7y4jq`, snapshot root `bafybeict6ibbchgt3ymi7v4re7354kfvwnryuoqpa4bjfa3moicfeoswiu`. Run `2026-10-07T18-31-50Z` (complete, forced republish): manifest `bafybeihabollsxvyqj2vnhhhh6w3ouygh6pvhdjrg2nx4i5u63gjdlom64` (`previousManifestCid` = run 2's), snapshot root `bafybeieaxkz56pcr2gf6ga75s7xu3zfp3djnhn745lrmk27i7rux64aw54`. The live manifest is also at `/api/manifest`.

### Documents

- [Design](docs/superpowers/specs/2026-10-07-santa-clara-pipeline-design.md)
- [Source catalog](docs/sources.md)
- [Limitations](docs/limitations.md)
- [Demo script](docs/demo-script.md)
- [Agent guide](CLAUDE.md)
