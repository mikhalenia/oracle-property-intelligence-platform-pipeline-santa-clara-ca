import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as q from "./queries";
import {
  AgedRoofsQuery,
  ApnParam,
  ContractorParam,
  OpenPermitsQuery,
  RadiusQuery,
} from "./schemas";

const text = (result: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(result) }],
});

const PROVENANCE =
  "Every result carries the snapshot { runId, manifestCid, syncedAt } (manifestCid is the IPFS CID of the published snapshot manifest) and each lead includes provenance (property and permit source URL, source version, fetchedAt).";
const SPATIAL =
  "Center is lat/lon in Santa Clara County; radiusMiles is in miles (default 5, max 25); limit defaults to 200 (max 500); distanceMiles is in miles.";
const DAYS_OPEN =
  "daysOpen is computed as of today for open and stalled permits, and issue→final for finaled permits.";
const STATES =
  'Permit states (permitState machine value, with permitStateLabel for display): open = "Open" (issued, still active), expired_unfinaled = "Stalled (expired without a final inspection)", finaled = "Completed" (completed with a final inspection). Show permitStateLabel to people, never the raw value. Roof age basis: roofAgeAnchor final_date = "final inspection date", approval_complete_issue_date = "approval completed (issue date)" (roofAgeBasisLabel); roofAgeConfidence high = "high confidence", medium = "estimated" (roofAgeConfidenceLabel). approvalsComplete is true when the permit\'s approvals include Complete (the work was approved as complete). Stalled = expired without a final inspection and without a completed approval.';

type ToolEnv = { DB: D1Database; MANIFEST_GATEWAY: string };

export function registerTools(server: McpServer, env: ToolEnv): void {
  const db = env.DB;
  server.registerTool(
    "search_properties_in_radius",
    {
      description: `List parcels within a radius, nearest first, each with its latest roofing permit, estimated roof age (years), contractor and latest observed owner when known. ${SPATIAL} ${STATES} ${DAYS_OPEN} ${PROVENANCE}`,
      inputSchema: RadiusQuery.shape,
    },
    async (args) => text({ snapshot: await q.snapshot(db), items: await q.radius(db, args) }),
  );

  server.registerTool(
    "find_aged_roofs",
    {
      description: `Find re-roofing leads: parcels whose estimated roof age in years is at least minRoofAgeYears (default 15), oldest roofs first, then nearest. Roof age is derived from roofing permits only: the final inspection date (roofAgeConfidence high, labelled "high confidence") or, failing that, the issue date of a permit whose approvals are Complete (roofAgeConfidence medium, labelled "estimated"); parcels with no such permit have no roof age and are not returned. ${DAYS_OPEN} ${SPATIAL} ${PROVENANCE}`,
      inputSchema: AgedRoofsQuery.shape,
    },
    async (args) => {
      const items = await q.agedRoofs(db, args);
      return text({
        snapshot: await q.snapshot(db),
        items,
        truncated: q.isTruncated(items, args.limit),
      });
    },
  );

  server.registerTool(
    "find_open_roofing_permits",
    {
      description: `Find permits that never received a final inspection, longest-open first. The response carries truncated: true when exactly limit rows came back (more may exist; say "at least N"). ${STATES} state filter: open, expired_unfinaled, or any (default; open + expired_unfinaled, never finaled). An open permit whose approvals are Complete still counts as open; an expired permit with a Complete approval is finished work, not stalled, and is not returned (it anchors a roof age instead). minOpenYears is in years (default 0); ${DAYS_OPEN} roofingOnly defaults to true. expired_unfinaled rows carry permitStateLabel "Stalled (expired without a final inspection)" (no final inspection and no completed approval). ${SPATIAL} ${PROVENANCE}`,
      inputSchema: OpenPermitsQuery.shape,
    },
    async (args) => {
      const items = await q.openPermits(db, args);
      return text({
        snapshot: await q.snapshot(db),
        items,
        truncated: q.isTruncated(items, args.limit),
      });
    },
  );

  server.registerTool(
    "get_property",
    {
      description: `Full detail for one parcel by APN: property, all permits (with permitState: ${STATES} ${DAYS_OPEN}), roof age (years), observed owners and contractors with CSLB license status. ${PROVENANCE}`,
      inputSchema: ApnParam.shape,
    },
    async ({ apn }) => text((await q.property(db, apn)) ?? { error: "not found", apn }),
  );

  server.registerTool(
    "get_contractor",
    {
      description: `One contractor by id with CSLB license number/status, permit counts and all of its permits. ${STATES} ${DAYS_OPEN} ${PROVENANCE}`,
      inputSchema: ContractorParam.shape,
    },
    async ({ id }) => text((await q.contractor(db, id)) ?? { error: "not found", id }),
  );

  server.registerTool(
    "list_runs",
    {
      description:
        "List pipeline run records stored in the snapshot, newest first by runId. Each record has runId, timing, asOf, status, per-source fetch counts and source versions, row totals, known limitations, and manifestCid (the IPFS CID of that run's published manifest, or null if the run was never published). Published runs also carry the manifest and, once checked, the gateway verification report (verification.ok, per-artifact independentOk counts). get_manifest returns the served snapshot's manifest.",
      inputSchema: {},
    },
    async () => text(await q.runs(db)),
  );

  server.registerTool(
    "get_manifest",
    {
      description:
        "The manifest of the snapshot currently served (its run is the snapshot's runId, else the newest run). Returns { runId, manifestCid, manifestUrl, manifest }: manifestUrl is <IPFS gateway>/ipfs/<manifestCid> and manifest is that JSON as stored in the synced run record at publish time (fetched from the gateway only when the record lacks it) (schema scc-manifest/1: county, publishedAt, previousManifestCid and artifacts with each file's cid, path, size and sha256), so answers can be verified against IPFS. If the run is unpublished or the fallback gateway fetch fails, manifest is null and error explains why.",
      inputSchema: {},
    },
    async () => text(await q.manifest(db, env.MANIFEST_GATEWAY, (url) => fetch(url))),
  );
}
