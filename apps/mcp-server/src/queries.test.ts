import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import * as q from "./queries";
import { CENTER, MANIFEST, MANIFEST_URL, seed } from "./test/seed";

const base = { ...CENTER, radiusMiles: 5, limit: 200 };

beforeAll(async () => {
  await seed(env.DB);
});

describe("queries", () => {
  it("snapshot reads row id 1", async () => {
    expect(await q.snapshot(env.DB)).toEqual({
      runId: "run-2",
      manifestCid: "bafy-manifest",
      syncedAt: "2026-10-07T18:00:00Z",
    });
  });

  it("radius returns the two nearby properties sorted by distance", async () => {
    const items = await q.radius(env.DB, base);
    expect(items.map((i) => i.apn)).toEqual(["A-001", "B-002"]);
    expect(items[0]!.distanceMiles).toBeLessThan(items[1]!.distanceMiles);
    expect(items[1]!.distanceMiles).toBeLessThan(1);
    for (const lead of items)
      expect(lead.provenance.permitSourceUrl).toBe("https://data.sanjoseca.gov/permits");
    expect(items[0]).toMatchObject({
      permitNumber: "2023-001-RF",
      permitState: "open",
      contractorId: "acme-roofing",
      cslbLicenseNumber: "123456",
      ownerName: "SMITH JOHN",
      bbbRating: null,
      provenance: {
        propertySourceUrl: "https://data.sccgov.org/parcels",
        fetchedAt: "2026-10-07T17:00:00Z",
      },
    });
  });

  it("radius limits candidate parcels before joining permits and owners", async () => {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${q.RADIUS_SQL}`)
      .bind(37, 38, -122, -121, 37.33, -121.88, 0.63, 8)
      .all<{ detail: string }>();
    const plan = results.map((r) => r.detail).join("\n");
    expect(plan).toMatch(/CO-ROUTINE|MATERIALIZE/);
  });

  it("agedRoofs returns only roofs at least the minimum age", async () => {
    const items = await q.agedRoofs(env.DB, { ...base, minRoofAgeYears: 15 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      apn: "B-002",
      roofAgeYears: 20,
      roofAgeAnchor: "final_date",
      roofAgePermit: "2006-002-RF",
    });
    expect(items[0]!.provenance.permitSourceUrl).toBeTruthy();
  });

  it("openPermits(any, 2y) returns the open permit, never finaled", async () => {
    const items = await q.openPermits(env.DB, {
      ...base,
      state: "any",
      minOpenYears: 2,
      roofingOnly: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.daysOpen).toBeGreaterThanOrEqual(730);
    expect(items[0]).toMatchObject({
      apn: "A-001",
      permitState: "open",
      permitNumber: "2023-001-RF",
    });
    expect(items[0]!.provenance.permitSourceUrl).toBeTruthy();
  });

  it("openPermits(expired_unfinaled) returns nothing", async () => {
    const items = await q.openPermits(env.DB, {
      ...base,
      state: "expired_unfinaled",
      minOpenYears: 0,
      roofingOnly: true,
    });
    expect(items).toEqual([]);
  });

  it("property composes all sections", async () => {
    const detail = await q.property(env.DB, "A-001");
    expect(detail).not.toBeNull();
    expect(detail!.snapshot.manifestCid).toBe("bafy-manifest");
    expect(detail!.property).toMatchObject({
      apn: "A-001",
      situsAddress: "100 MAIN ST",
      sourceUrl: "https://data.sccgov.org/parcels",
    });
    expect(detail!.permits).toHaveLength(1);
    expect(detail!.permits[0]).toMatchObject({
      permitNumber: "2023-001-RF",
      isRoofing: true,
      daysOpen: 1096,
    });
    expect(detail!.roofAge).toBeNull();
    expect(detail!.owners).toEqual([
      { ownerName: "SMITH JOHN", observedOn: "2023-10-07", permitNumber: "2023-001-RF" },
    ]);
    expect(detail!.contractors).toEqual([
      expect.objectContaining({
        contractorId: "acme-roofing",
        cslbStatus: "Active",
        bbbRating: null,
      }),
    ]);
    const b = await q.property(env.DB, "B-002");
    expect(b!.roofAge).toEqual({
      roofDate: "2006-06-15",
      roofAgeYears: 20,
      anchor: "final_date",
      confidence: "high",
      permitNumber: "2006-002-RF",
    });
  });

  it("property returns null for unknown apn", async () => {
    expect(await q.property(env.DB, "nope")).toBeNull();
  });

  it("contractor returns contractor with its permits", async () => {
    const r = await q.contractor(env.DB, "acme-roofing");
    expect(r!.contractor).toMatchObject({ companyName: "ACME ROOFING INC", permitCount: 2 });
    expect(r!.permits.map((p) => p.permitNumber)).toEqual(["2023-001-RF", "2006-002-RF"]);
    expect(await q.contractor(env.DB, "nope")).toBeNull();
  });

  it("runs newest first, each carrying manifestCid", async () => {
    const runs = (await q.runs(env.DB)) as { runId: string; manifestCid: string | null }[];
    expect(runs.map((r) => r.runId)).toEqual(["run-3", "run-2", "run-1"]);
    expect(runs[1]!.manifestCid).toBe("bafy-manifest");
  });

  it("manifest resolves the snapshot run and fetches the manifest from the gateway", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      return Response.json(MANIFEST);
    };
    expect(await q.manifest(env.DB, "https://ipfs.filebase.io", fetcher)).toEqual({
      runId: "run-2",
      manifestCid: "bafy-manifest",
      manifestUrl: MANIFEST_URL,
      manifest: MANIFEST,
    });
    expect(urls).toEqual([MANIFEST_URL]);
  });

  it("manifest reports gateway failures as manifest null with an error", async () => {
    const failing = async () => new Response("bad gateway", { status: 502 });
    const r = await q.manifest(env.DB, "https://ipfs.filebase.io", failing);
    expect(r).toMatchObject({ runId: "run-2", manifestCid: "bafy-manifest", manifest: null });
    expect(r.error).toMatch(/502/);
    const throwing = async (): Promise<Response> => {
      throw new Error("network down");
    };
    expect((await q.manifest(env.DB, "https://ipfs.filebase.io", throwing)).error).toMatch(
      /network down/,
    );
  });

  it("manifest falls back to the newest run when there is no snapshot row", async () => {
    await env.DB.prepare("DELETE FROM snapshot").run();
    const r = await q.manifest(env.DB, "https://ipfs.filebase.io", async () =>
      Response.json(MANIFEST),
    );
    expect(r).toMatchObject({
      runId: "run-3",
      manifestCid: null,
      manifestUrl: null,
      manifest: null,
    });
    expect(r.error).toMatch(/not published/);
  });
});
