import { describe, expect, it } from "vitest";
import { contractorId, normalizeCompanyName, splitContractor } from "./contractor";

describe("splitContractor", () => {
  it("splits company and contact on double space", () =>
    expect(splitContractor("PEACH ROOFING SOLUTIONS INC  Jason Nesbitt")).toEqual({
      companyName: "PEACH ROOFING SOLUTIONS INC",
      contactName: "Jason Nesbitt",
    }));
  it("handles company only with trailing spaces", () =>
    expect(splitContractor("BARNUM & CELILLO ELECTRIC INC   ")).toEqual({
      companyName: "BARNUM & CELILLO ELECTRIC INC",
      contactName: null,
    }));
  it("empty is null/null", () =>
    expect(splitContractor("   ")).toEqual({ companyName: null, contactName: null }));
});

describe("normalizeCompanyName", () => {
  it("upper-cases, strips punctuation and legal suffixes", () => {
    expect(normalizeCompanyName("Peach Roofing Solutions, Inc.")).toBe("PEACH ROOFING SOLUTIONS");
    expect(normalizeCompanyName("ECONOMY ROOFING INC")).toBe("ECONOMY ROOFING");
    expect(normalizeCompanyName("A S E Builders LLC")).toBe("A S E BUILDERS");
  });
});

describe("contractorId", () => {
  it("is stable and 16 hex chars", () => {
    const id = contractorId("Peach Roofing Solutions, Inc.");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(contractorId("PEACH ROOFING SOLUTIONS INC")).toBe(id);
  });
});
