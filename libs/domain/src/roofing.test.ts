import { describe, expect, it } from "vitest";
import { isRoofingWork } from "./roofing";

describe("isRoofingWork", () => {
  it("matches ReRoof work description", () =>
    expect(isRoofingWork({ workDescription: "ReRoof" })).toBe(true));
  it("matches Re-Roof and roofing in subtype/folder", () => {
    expect(isRoofingWork({ subtype: "Re-Roof Residential" })).toBe(true);
    expect(isRoofingWork({ folderName: "ROOFING REPAIR" })).toBe(true);
    expect(isRoofingWork({ folderName: "shingle replacement" })).toBe(true);
  });
  it("does not match unrelated or substring-only words", () => {
    expect(isRoofingWork({ workDescription: "Tenant Improvement" })).toBe(false);
    expect(isRoofingWork({ workDescription: "Fireproofing" })).toBe(false);
    expect(isRoofingWork({})).toBe(false);
  });
});
