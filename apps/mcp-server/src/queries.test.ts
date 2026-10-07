import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import * as q from "./queries";
import { CENTER, seed } from "./test/seed";

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

  it("runs newest first and manifest from newest run", async () => {
    const runs = await q.runs(env.DB);
    expect(runs.map((r) => (r as { runId: string }).runId)).toEqual(["run-2", "run-1"]);
    expect(await q.manifest(env.DB)).toEqual({ schema: "scc-manifest/1" });
  });
});
