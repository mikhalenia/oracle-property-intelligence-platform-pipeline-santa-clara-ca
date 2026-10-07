# Limitations

What the free, open sources cannot deliver for each assignment acceptance criterion, and what the
pipeline does instead. Observations are from 2026-10-07.

## Strings recorded in every run

The pipeline writes these verbatim into `limitations` of every run record
(`STATIC_LIMITATIONS` in `apps/pipeline/src/commands/ingest.ts`; visible in `docs/runs/*.json`
and the Explorer):

- Permits cover the City of San José only; the other 15 jurisdictions have no open bulk feed in this milestone.
- No public owner mailing address or transfer date (Assessor roll is paid); ownership is observed from permit records.
- No public year-built field; roof age is derived only from completed roofing permits.
- BBB ratings are not publicly downloadable; bbb_rating is always null.

A source that fails during a run adds its own entry and marks the run `partial` (run 1,
`2026-10-07T17-05-59Z`: parcels page read failed, permits loaded). Run 1 has no record in `docs/runs/`; it is visible via `GET /api/runs` and in the `runs.json` artifact published inside the snapshot.

## By acceptance criterion

| Criterion | Status | Detail |
|---|---|---|
| Properties not transferred in more than 10 years; regional or out-of-area owners | Not met | No public owner mailing address or transfer date. The Assessor secured roll is sold for $495 (MF901B), and per-parcel PDF terms prohibit resale. Owner names are only those observed on permit records (`owners`, one row per permit observation, 77,359 in run 2), so most parcels have none. |
| Roof age or proxy (year built, last roofing permit) | Partly met | Year built is not available. Roof age is derived only from roofing permits with a final date (confidence high) or approvals marked Complete (anchor is the issue date, confidence medium). Parcels without such a permit have unknown roof age: 7,151 roof-age rows against 494,841 parcels. Roofing permits by state in run 2: expired_unfinaled 6,707, open 1,017, finaled 27. Roof age of at least 15 years: 2,021 parcels. |
| BBB rating scores | Not met | No public bulk source. `bbb_rating` is in the contract and is always null. |
| Contractor records | Partly met | 8,920 contractors derived from permit contractor fields, reconciled by normalized company name. Not matched to CSLB licenses: the CSLB portal answered 200 from Cloudflare egress but 503 or timeouts locally, and the matching was deferred. |
| Business records | Not met | California SOS BizFile is behind Incapsula; not scraped. |
| Permits across the county | Partly met | City of San José only (93,093 permits; 63,853 matched to a parcel by APN, the rest kept with a null APN). The other 15 jurisdictions are listed in `docs/sources.md`; each needs its own adapter. |
| Coordinates | Met with a caveat | Parcel coordinates are the bounding-box center of the parcel polygon, not a surveyed rooftop point. |
| Change detection for parcels | Dataset-level | The Socrata `:updated_at` is one timestamp for the whole dataset (2026-08-26T16:22:37Z at run 2), so a changed timestamp triggers a full re-read. San José CSVs have per-resource `last_modified`, also not row-level; row changes are found by `record_hash` comparison during upsert. |
| Atlas registration | Not done | Registration requires a code-owner merge outside this repository. |
| IPNS | Not used, by choice | The CID history in `docs/runs/*.json` (each manifest records `previousManifestCid`) is the pointer. The assignment makes IPNS optional. |

## Source speed and constraints

- Parcels: one Socrata dataset read in pages of 10,000 rows; the full read is the slowest ingest step. Run 2 ingest ran from 17:10:54Z to 17:15:02Z (`startedAt`, `finishedAt`).
- San José ArcGIS permit service: HTTP 522 from local and Cloudflare egress.
- CSLB: 503 or timeouts from local egress.
- Assessor roll: paid. BBB: no bulk. BizFile: bot-protected.

## IPFS gateway situation

The assignment asks for retrieval from at least two independent public gateways. Observed on
2026-10-07:

- `ipfs.io`, `dweb.link` and `w3s.link` answered HTTP 429 with a "switching to a service worker gateway" message on files, and 522 on the directory root, to non-browser clients, so scripted verification cannot use them. They may work in a browser.
- Working independent gateways: `gateway.pinata.cloud` and `ipfs.raribleuserdata.com` returned 200 on every artifact in run 2's verification. `ipfs.ssi.eecc.de` is intermittent: it timed out on the directory root, `properties.parquet` and the CAR.
- `ipfs.filebase.io` is the pinning vendor's gateway; it is not counted as independent.

The `verify` command probes the list in `apps/pipeline/src/publish/gateways.ts` and records
per-gateway results in `verification` inside each `docs/runs/*.json`.

`ipfs.raribleuserdata.com` answers with `server: Filebase` and `x-filebase-*` headers (observed
2026-10-07): it is a dedicated gateway run on the pinning vendor's infrastructure, so its
independence from the vendor is weaker than its name suggests. `gateway.pinata.cloud` is
operated separately.

Verification results reach the Explorer: `verify` writes the report into the run record, the next
`sync` carries it to D1, and the Manifest page shows it in its Verification section.

## Roof age and stalled permits

- Roof age comes from roofing permits only: the final inspection date (confidence high) or, when
  there is none, the issue date of a permit whose approvals include "Complete" (confidence medium).
- Stalled = expired without a final inspection and without a completed approval. An expired
  permit whose approvals include "Complete" is finished work awaiting paperwork: it anchors a
  medium-confidence roof age and is never listed as stalled (`approvalsComplete` in API
  rows, `approvals_complete` and `is_stalled` in `leads.parquet`). Before this rule, 178 of the
  200 aged-roof leads within 5 miles of downtown San José were also listed as stalled permits.
  An open permit whose approvals are all complete still counts as open; only expired permits without a final inspection are "stalled".

## Permits that leave the feeds

A permit that disappears from the San José feeds keeps its last observed state; `last_seen_run`
(in `permits.parquet`) tells when it was last seen. Finaled permits drop out of the active,
under-inspection and expired files, so deleting them would also delete their roof-age evidence.

## Publishing cost and growth

Each published run stores the CAR twice on Filebase (once imported as the DAG, once as a plain
object fetchable by its own CID): about 84 MB per published run. `publish` therefore skips a run
whose sources were all unchanged when an earlier run is published ("nothing changed since
<run>; use --force to republish"), and the scheduled workflow runs plain `run`, so an unchanged
day publishes nothing (`run --force` overrides). Roof ages in the published snapshot stay as of
the last published run until the next publish.

## D1 sync safety

A full D1 sync deletes every table and exceeds the free-tier write budget (the design stays within 100k row writes/day; the account currently runs on Workers Paid), so `sync` refuses an
implicit full sync when D1 already holds a snapshot. Without the local marker
(`data/d1-sync-state.json`, cached by the workflow with the DuckDB file) the job fails and names
the fix: `sync --bootstrap-state --run <D1 run id>` on a database whose newest run is the D1 run,
or `sync --full` to rewrite D1 deliberately.

## Days open

`days_open` in `leads.parquet` is computed as of the run date for non-finaled permits; the API computes it as of today.
