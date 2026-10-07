## Summary

- Santa Clara County pipeline: 494,841 County parcels (Socrata) and 93,093 City of San José building permits (CKAN CSVs) loaded into DuckDB with per-record provenance and hash-based change detection.
- Derived roofing signals: 7,751 roofing permits with open / expired-without-final / finaled states, 8,920 contractors, 7,151 roof-age rows (2,021 parcels at 15 years or more).
- Each run exports Parquet and publishes a CIDv1 UnixFS directory plus a CAR to Filebase, with a manifest; retrieval is verified from independent public gateways.
- A Cloudflare Worker serves the snapshot over REST and MCP (seven tools); an Explorer app shows runs, a leads page over the REST endpoints, sources, the manifest with verification, and a DuckDB-WASM SQL panel.
- Several criteria are only partly met or not met (BBB, business records, owner transfer and mailing data); see Limitations.

## Live runtime

- REST and MCP: https://scc-pipeline-api.mikhalenia-a.workers.dev
- Explorer: https://scc-explorer.mikhalenia-a.workers.dev
- No credentials are needed to read either. The sibling CRM is in a separate PR (see the roofing-crm PR).

**Demo video:** _to be added before marking ready_

## How to review in 2 minutes

1. `curl -s https://scc-pipeline-api.mikhalenia-a.workers.dev/api/health | jq`
2. Open https://scc-explorer.mikhalenia-a.workers.dev and look at Runs, Leads, Sources and Manifest.
3. `curl -s https://scc-pipeline-api.mikhalenia-a.workers.dev/api/manifest | jq` (CID, name, size, codec, sha256 per artifact).
4. Fetch one artifact from two independent gateways and compare the size with the manifest: `curl -sI https://gateway.pinata.cloud/ipfs/bafkreigacann4wwdk4rvw7ujtqpxecvqnefg7tjgzrnedcqgfks7az5alu` and `curl -sI https://ipfs.raribleuserdata.com/ipfs/bafkreigacann4wwdk4rvw7ujtqpxecvqnefg7tjgzrnedcqgfks7az5alu` (`coverage.json`, 1,508 bytes).
5. `curl -s "https://scc-pipeline-api.mikhalenia-a.workers.dev/api/leads/aged-roofs?lat=37.3382&lon=-121.8863&radiusMiles=5&minRoofAgeYears=15" | jq`
6. `curl -s "https://scc-pipeline-api.mikhalenia-a.workers.dev/api/leads/open-permits?lat=37.3382&lon=-121.8863&radiusMiles=5&state=any&minOpenYears=5" | jq`
7. Compare the two manifests (`docs/runs/2026-10-07T17-10-54Z.json` and `docs/runs/2026-10-07T18-31-50Z.json`): identical CIDs for unchanged Parquet files (`properties`, `owners`, `roof_age`), and run 3's `previousManifestCid` equals run 2's manifest CID.
8. `curl -X POST https://scc-pipeline-api.mikhalenia-a.workers.dev/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`


## What is in the dataset

Run 3 (`2026-10-07T18-31-50Z`, complete, forced republish) has the same totals as run 2 (`2026-10-07T17-10-54Z`, complete); figures from `docs/runs/2026-10-07T17-10-54Z.json`:

| Table | Rows | Source |
|---|---|---|
| properties | 494,841 | County of Santa Clara open data (Socrata `ubcd-cewv`) |
| permits | 93,093 (63,853 matched to a parcel by APN) | City of San José CKAN CSVs |
| roofing permits | 7,751 | derived from permits |
| contractors | 8,920 | derived from permit contractor fields |
| owners (observations) | 77,359 | permit records |
| roof age | 7,151 | derived from roofing permits |

Roofing permits by state: expired_unfinaled 6,707, open 1,017, finaled 27.

## Published artifacts

Two published runs, chained by `previousManifestCid` (run 1 was partial and not published):

| Run | Manifest CID | Root CID | CAR CID |
|---|---|---|---|
| 2 `2026-10-07T17-10-54Z` | `bafybeidav5d5sigbbrvfhaexjxa6nqszyfmcpscyhqpnuv65hribw7y4jq` | `bafybeict6ibbchgt3ymi7v4re7354kfvwnryuoqpa4bjfa3moicfeoswiu` | `bafybeic2s2oiuq5edcuj52e2lhgxmms442pk56fqtzg746c2oun5quo2b4` (41,904,022 bytes) |
| 3 `2026-10-07T18-31-50Z` | `bafybeihabollsxvyqj2vnhhhh6w3ouygh6pvhdjrg2nx4i5u63gjdlom64` | `bafybeieaxkz56pcr2gf6ga75s7xu3zfp3djnhn745lrmk27i7rux64aw54` | `bafybeidagvcg5n2vokbw5rkyyhqvwv6qatoxw2vz5aaom2v4uaxju5lx5u` (41,723,962 bytes) |

- Chain: run 3 manifest -> `previousManifestCid` = run 2 manifest (run 2's `previousManifestCid` is null). Run 2's manifest still resolves (checked on gateway.pinata.cloud).
- Run 3 was a forced incremental republish with every source unchanged (`skipped: true`). `properties`, `owners` and `roof_age` Parquet kept identical CIDs (content addressing); `leads` (gained `approvals_complete`, `is_stalled`; `days_open` computed as of the run date), `permits`, `contractors` and the other artifacts changed.
- Records: `docs/runs/<run_id>.json` holds the run record, manifest and verification results; the live manifest is at `/api/manifest`.
- Run 2: every artifact (9 files, the directory root and the CAR: 11 objects) was served with matching size and SHA-256 by two independent gateways, `gateway.pinata.cloud` and `ipfs.raribleuserdata.com`; `ipfs.ssi.eecc.de` was intermittent. Run 3: verification ok, every object served by at least 2 independent gateways (10 of 11 by 3: pinata, rarible, ssi). `ipfs.io` and `dweb.link` answered 429 or 522 to non-browser clients, so verification did not use them.
- IPNS is not used; the CID history (`previousManifestCid`) is the pointer.

## Incremental ingestion

- `.github/workflows/ingest.yml` runs `pnpm nx run pipeline:cli -- run` daily at 00:30 UTC (after San José's 16:00 PT refresh) and on demand, caches `data/` (DuckDB and the D1 sync marker) even when a step fails, and commits a new `docs/runs/*.json` per run.
- Each run records per-source inserted/updated/unchanged/removed counts, source versions and limitations. Unchanged sources are skipped by version; row changes are found by `record_hash`. Parcel change detection is dataset-level only.
- Republishing yields a new manifest CID that points to the previous one; earlier records are never rewritten.
- The scheduled workflow has not executed yet; all runs so far were started by hand. Run 3 was a forced republish (`--force`) with unchanged sources, so no changed source record has been observed yet; the live `/api/health` reports run 3 and `/api/runs` records carry `manifest` and `verification`.
- D1 sync is incremental: `sync` writes only changed rows (designed to stay within the free tier (100k row writes/day), which was hit on 2026-10-07; the account currently runs on Workers Paid; run 3's incremental sync wrote 3 rows), `sync --full` rewrites everything, and `sync --bootstrap-state --run <id>` adopts an existing D1 snapshot without writes. An implicit full sync over an existing D1 snapshot is refused, so a lost cache fails the job instead of wiping D1.
- A run whose sources were all unchanged is not republished (`run --force` overrides); each publish stores about 84 MB.

## Architecture

- `apps/pipeline`: CLI (`ingest`, `export`, `publish`, `verify`, `sync`, `run`).
- `libs/sources`: Socrata and CKAN fetchers that attach provenance.
- `libs/domain`: pure rules (APN normalization, roofing classifier, permit state, roof age, contractor names, geo).
- `apps/mcp-server`: Cloudflare Worker (Hono) with REST and MCP at `/mcp` over D1; both use the same handlers.
- `apps/explorer`: React + MUI + Vite on a Cloudflare Worker with static assets; DuckDB-WASM reads the published Parquet by CID.
- Storage: DuckDB locally, Parquet and CAR on IPFS via Filebase, D1 for the served snapshot.

## Golden Path deviation

- Cloudflare Workers, D1 and static assets instead of AWS/CDK: the assignment requires no ongoing Oracle infrastructure cost, and nothing here runs always-on.
- TypeScript throughout, nx, pnpm, Vitest and GitHub Actions follow the kit's conventions. The Vercel AI SDK is not used because this repo has no LLM calls; agents connect through MCP.

## Limitations

Full list: `docs/limitations.md`. Top 5:

1. Permits cover the City of San José only; 15 other jurisdictions are catalogued, not loaded.
2. No owner mailing address or transfer dates (Assessor roll is paid), so the 10-year-ownership and out-of-area-owner questions are not supported.
3. No year built; roof age exists only where a roofing permit does (7,151 of 494,841 parcels).
4. BBB ratings are not available (`bbb_rating` is always null) and CSLB licenses are not matched.
5. No business records (SOS BizFile is bot-protected); Atlas registration is not done (requires a code-owner merge).

## Acceptance criteria

Traceability table with evidence: `docs/acceptance-criteria.md`. Of 59 rows (47 criteria and 12 demo steps): 34 met, 20 partial, 4 gap, 1 n/a (IPNS, optional and not used).

## Kit usage

No kit agent was run to build this. What follows is influence on the design, not tool usage.

- Publication conventions (CIDv1, a CAR per snapshot, a manifest with cid/size/sha256, immutable republish) follow the Elephant oracle skills' publication model named in the assignment.
- The MCP server serves an accepted snapshot synced into D1 and never fetches remote archives per request, the pattern described in the kit's `deploy-open-data-mcp` skill; see `apps/pipeline/src/sync` and `apps/mcp-server/src/queries.ts`.
- Engineering baseline from the kit's `apply-engineering-guidelines`: TypeScript strict, nx, Vitest, GitHub Actions, Conventional Commits. The Cloudflare deviation is stated above.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
