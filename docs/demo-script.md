# Demo script

Click-by-click version of the README "Demo Transcript", in the same order, against the live
deployment.

```sh
API=https://scc-pipeline-api.mikhalenia-a.workers.dev
EXPLORER=https://scc-explorer.mikhalenia-a.workers.dev
```

Steps marked **[Explorer]** depend on the Explorer deploy. Each has a REST or file equivalent
that works without it. Figures below are from run 2 (`2026-10-07T17-10-54Z`); a later scheduled
run will show newer numbers.

## 0. Introduction

Say the presenter line from the transcript. Everything below is served from free tiers:
Cloudflare Workers, D1 and static assets for access, Filebase plus the public IPFS network for storage,
GitHub Actions for scheduling. Nothing is always-on.

## 1. Pipeline run summary

- **[Explorer]** Open `$EXPLORER`, Runs page: status, sources, versions, counts, deltas, limitations.
- REST: `curl -s $API/api/runs | jq`.
- Expect: run 1 `2026-10-07T17-05-59Z` (partial: parcels page read failed, permits loaded) and run 2 `2026-10-07T17-10-54Z` (complete), with the four limitation strings from `docs/limitations.md`.

## 2. Records by source

- **[Explorer]** Sources page.
- REST: `curl -s $API/api/runs | jq` and read `sources` and `totals`.
- Expect for run 2: 494,841 properties, 93,093 permits, 7,751 roofing permits, 8,920 contractors, 77,359 owner observations, 7,151 roof-age rows, each source with `sourceVersion` and fetch counts. Say aloud that `bbb_rating` is always null and why.

## 3. DuckDB-backed query layer

- **[Explorer]** SQL page: DuckDB-WASM reads the published Parquet from an IPFS gateway by CID in the browser. The page shows the gateway in use (the first of `ipfs.raribleuserdata.com`, `gateway.pinata.cloud`, `ipfs.filebase.io` to answer a range probe). Run a pre-filled example query. No Oracle-hosted database is involved.
- Without the Explorer: `pnpm nx run pipeline:cli -- export` writes the same Parquet locally and `duckdb` can query it.

## 4. Artifact manifest

- REST: `curl -s $API/api/manifest | jq`.
- **[Explorer]** Manifest page.
- Expect: `cid`, `name`, `size`, `codec`, `sha256` per artifact, with gateway URLs derived from CIDs. Run 2 manifest CID `bafybeidav5d5sigbbrvfhaexjxa6nqszyfmcpscyhqpnuv65hribw7y4jq`, snapshot root `bafybeict6ibbchgt3ymi7v4re7354kfvwnryuoqpa4bjfa3moicfeoswiu`, CAR `bafybeic2s2oiuq5edcuj52e2lhgxmms442pk56fqtzg746c2oun5quo2b4` (41,904,022 bytes). No IPNS name is used; the CID is the identity.

## 5. Fetch by CID from two independent gateways

- **[Explorer]** Manifest page, Verification section: per-gateway results for every artifact and the number of independent gateways that served matching bytes (from the run record; it appears after the run's next sync).
- Command line, any artifact CID from step 4:

  ```sh
  curl -sI https://gateway.pinata.cloud/ipfs/<cid>
  curl -sI https://ipfs.raribleuserdata.com/ipfs/<cid>
  ```

  Compare `content-length` and the SHA-256 of the body with the manifest.
- Note: `ipfs.io`, `dweb.link` and `w3s.link` answered 429 "switching to a service worker gateway" on files and 522 on the directory root to non-browser clients on 2026-10-07; `ipfs.ssi.eecc.de` is intermittent (it timed out on the directory root, `properties.parquet` and the CAR in run 2's verification), while `gateway.pinata.cloud` and `ipfs.raribleuserdata.com` returned 200 on everything; `ipfs.filebase.io` is the vendor and does not count as independent. See `docs/limitations.md`.
- Recorded results: `verification` in `docs/runs/<run_id>.json`. Re-run with `pnpm nx run pipeline:cli -- verify` (needs the local export of that run).

## 6. A later publish produces a new CID

- `curl -s $API/api/runs | jq` and show both runs (run 1 is partial and was not published; run 2 is the first published run, so its manifest has `previousManifestCid: null`).
- Show `docs/runs/*.json` in the repository: past records are never rewritten. Only run 2 has a record there; run 1 is visible via `/api/runs` and in the `runs.json` artifact inside the snapshot. The scheduled `ingest` workflow adds one record per run, and its manifest will carry a new CID and point to run 2's as `previousManifestCid`.
- The snapshot root is a directory; its CAR is listed in the manifest.

## 7. Aged roofs in a radius (UI)

Center: downtown San José, 37.3382, -121.8863, 5 miles, roofs at least 15 years old.

- **[Explorer]** Leads page (`$EXPLORER/leads`): click "Downtown San José", keep radius 5 and minimum roof age 15, click Search. The "Roofs at least 15 years old" table shows address, APN, roof age with its basis and confidence, latest permit, contractor, owner, distance and provenance (source links and the snapshot manifest CID).
- REST:

  ```sh
  curl -s "$API/api/leads/aged-roofs?lat=37.3382&lon=-121.8863&radiusMiles=5&minRoofAgeYears=15" | jq
  ```

- The API returns up to 500 rows (`limit`, default 200, maximum 500); the dataset holds 962 parcels in this radius in run 2 (2,021 county-wide at 15 years or more). Each row has the roof-age basis (anchor and confidence), coordinates and provenance. Point out that roof age exists only where a roofing permit exists.

## 8. Open roofing permits, longest open first

```sh
curl -s "$API/api/leads/open-permits?lat=37.3382&lon=-121.8863&radiusMiles=5&state=any&minOpenYears=5" | jq
```

- **[Explorer]** Leads page, same search: the "Roofing permits without a final inspection" table, longest open first; the permit-state selector picks any, open or stalled.
- Expect permit state (`open` or `expired_unfinaled`; stalled = expired without a final inspection and without a completed approval, so permits whose approvals are Complete are not listed), days open, contractor name, and provenance. BBB rating is null for every contractor; CSLB license fields are empty because matching was not done in this milestone.
- Drill down: `curl -s $API/api/properties/<apn> | jq` and `curl -s $API/api/contractors/<id> | jq`.

## 9. Agent queries

Ask an MCP-capable agent connected to `$API/mcp` the two transcript prompts (substituting San José for the city placeholder):

- "Which properties in Santa Clara County within five miles of San José have roofs older than 15 years?" Expect it to call `find_aged_roofs`.
- "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?" Expect `find_open_roofing_permits`, with the BBB gap and the stalled-permit wording stated as assumptions.

## 10. MCP readiness

Tools exposed: `search_properties_in_radius`, `find_aged_roofs`, `find_open_roofing_permits`, `get_property`, `get_contractor`, `list_runs`, `get_manifest`. Same data model as the REST routes.

List tools:

```sh
curl -X POST $API/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call a tool (the exact call to show):

```sh
curl -X POST $API/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_aged_roofs","arguments":{"lat":37.3382,"lon":-121.8863,"radiusMiles":5,"minRoofAgeYears":15}}}'
```

Every response includes the snapshot (including `manifest_cid`) and per-record provenance.

## Health check before the demo

```sh
curl -s $API/api/health | jq
```
