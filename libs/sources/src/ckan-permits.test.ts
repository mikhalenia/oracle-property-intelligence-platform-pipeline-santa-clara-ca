import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CKAN_PERMIT_RESOURCES,
  fetchCkanResourceVersion,
  mapPermit,
  parsePermitsCsv,
  type PermitRow,
} from "./ckan-permits";

const fixtures = join(__dirname, "../fixtures");
const prov = {
  sourceKey: "k",
  sourceUrl: "u",
  sourceVersion: "v",
  fetchedAt: "t",
  pageSha256: "h",
};

async function parse(file: string, key: "active" | "under_inspection") {
  const rows: PermitRow[] = [];
  for await (const r of parsePermitsCsv(join(fixtures, file), {
    key,
    sourceUrl: "u",
    sourceVersion: "v",
    fetchedAt: "t",
    pageSha256: "h",
  }))
    rows.push(r);
  return rows;
}

describe("ckan permits", () => {
  it("reads last_modified of the CSV resource", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(readFileSync(join(fixtures, "ckan-package.json"))));
    expect(await fetchCkanResourceVersion(fetcher, CKAN_PERMIT_RESOURCES.active.packageId)).toBe(
      "2026-10-07T16:00:08.000000",
    );
  });

  it("parses rows into PermitRow with classification and contractor split", async () => {
    const rows = await parse("permits-active.csv", "active");
    expect(rows).toHaveLength(5);
    const roof = rows.find((r) => r.permitNumber === "2026-137661-RS");
    expect(roof).toMatchObject({
      status: "active",
      isRoofing: true,
      apn: "46715052",
      issueDate: "2026-09-14",
      finalDate: null,
      contractorCompany: "PEACH ROOFING SOLUTIONS INC",
      contractorContact: "Jason Nesbitt",
      valuation: 24096,
      address: "100 N 13TH ST , SAN JOSE CA 95112-3442",
    });
    const noApn = rows.find((r) => r.permitNumber === "2018-112785-IR");
    expect(noApn?.apn).toBeNull();
    expect(noApn?.isRoofing).toBe(false);
    expect(noApn?.address).toBeNull();
    expect(rows.find((r) => r.permitNumber === "2010-024790-IR")?.finalDate).toBe("2010-10-25");
  });

  it("parses the inspection file with under_inspection status", async () => {
    const rows = await parse("permits-inspection.csv", "under_inspection");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "under_inspection")).toBe(true);
    expect(rows[0]?.permitNumber).toBe("2026-137661-RS");
  });

  it("skips unknown statuses unless the feed is last_30_days", () => {
    const raw = { FOLDERNUMBER: "2026-1-X", Status: "Pending" };
    expect(mapPermit(raw, "active", prov)).toBeNull();
    expect(mapPermit({ ...raw, Status: "30" }, "last_30_days", prov)?.status).toBe("active");
  });

  it("recordHash is stable across re-fetches", () => {
    const raw = { FOLDERNUMBER: "2026-1-X", Status: "Active" };
    const a = mapPermit(raw, "active", prov);
    const b = mapPermit(raw, "active", { ...prov, fetchedAt: "t2", pageSha256: "h2" });
    expect(a?.recordHash).toBe(b?.recordHash);
  });

  it("rejects when the file cannot be read", async () => {
    const iterate = async () => {
      const rows = parsePermitsCsv("/nonexistent.csv", {
        key: "active",
        sourceUrl: "u",
        sourceVersion: "v",
        fetchedAt: "t",
        pageSha256: "h",
      });
      await rows.next();
    };
    await expect(iterate()).rejects.toThrow(/ENOENT/);
  });
});
