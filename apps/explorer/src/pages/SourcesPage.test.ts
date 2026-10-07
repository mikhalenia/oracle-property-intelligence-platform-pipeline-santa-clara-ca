import { describe, expect, it } from "vitest";
import { CKAN_PERMIT_RESOURCES } from "../../../../libs/sources/src/ckan-permits";
import { PARCELS_URL } from "../../../../libs/sources/src/socrata-parcels";
import { CATALOG } from "./SourcesPage";

describe("source catalog urls", () => {
  it("match the fetcher constants", () => {
    const url = (k: string) => CATALOG.find((c) => c.key === k)?.url;
    expect(url("scc-parcels")).toBe(PARCELS_URL);
    for (const [status, r] of Object.entries(CKAN_PERMIT_RESOURCES)) {
      expect(url(`sj-permits-${status}`)).toBe(r.downloadUrl);
    }
  });
});
