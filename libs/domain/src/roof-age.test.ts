import { describe, expect, it } from "vitest";
import { deriveRoofAge } from "./roof-age";

const asOf = "2026-10-08";

describe("deriveRoofAge", () => {
  it("uses final date with high confidence", () =>
    expect(
      deriveRoofAge({ isRoofing: true, approvals: "B-Complete", issueDate: "2010-05-01", finalDate: "2010-06-15", asOf }),
    ).toEqual({ roofDate: "2010-06-15", roofAgeYears: 16, anchor: "final_date", confidence: "high" }));
  it("falls back to issue date when approvals say Complete", () =>
    expect(
      deriveRoofAge({ isRoofing: true, approvals: "B-4. Complete, E-4. Complete", issueDate: "2016-10-09", finalDate: null, asOf }),
    ).toEqual({ roofDate: "2016-10-09", roofAgeYears: 9, anchor: "approval_complete_issue_date", confidence: "medium" }));
  it("returns null when not roofing, not complete, or no dates", () => {
    expect(deriveRoofAge({ isRoofing: false, approvals: "B-Complete", issueDate: "2010-01-01", finalDate: "2010-02-01", asOf })).toBeNull();
    expect(deriveRoofAge({ isRoofing: true, approvals: "", issueDate: "2010-01-01", finalDate: null, asOf })).toBeNull();
    expect(deriveRoofAge({ isRoofing: true, approvals: "B-Complete", issueDate: null, finalDate: null, asOf })).toBeNull();
  });
  it("floors partial years", () =>
    expect(deriveRoofAge({ isRoofing: true, approvals: "", issueDate: null, finalDate: "2011-10-09", asOf })?.roofAgeYears).toBe(14));
});
