import { describe, expect, it } from "vitest";
import { daysOpen, derivePermitState } from "./permit-state";

describe("derivePermitState", () => {
  it("active without final date is open", () =>
    expect(derivePermitState({ status: "active", finalDate: null })).toBe("open"));
  it("under_inspection without final date is open", () =>
    expect(derivePermitState({ status: "under_inspection", finalDate: null })).toBe("open"));
  it("any status with final date is finaled", () =>
    expect(derivePermitState({ status: "expired", finalDate: "2020-01-01" })).toBe("finaled"));
  it("expired without final date is expired_unfinaled", () =>
    expect(derivePermitState({ status: "expired", finalDate: null })).toBe("expired_unfinaled"));
});

describe("daysOpen", () => {
  const asOf = "2026-10-08";
  it("open: issue to as-of", () =>
    expect(daysOpen({ state: "open", issueDate: "2026-08-14", finalDate: null, asOf })).toBe(55));
  it("finaled: issue to final", () =>
    expect(daysOpen({ state: "finaled", issueDate: "2020-01-01", finalDate: "2020-03-01", asOf })).toBe(60));
  it("expired_unfinaled: issue to as-of", () =>
    expect(daysOpen({ state: "expired_unfinaled", issueDate: "2016-10-08", finalDate: null, asOf })).toBe(3652));
  it("null without issue date", () =>
    expect(daysOpen({ state: "open", issueDate: null, finalDate: null, asOf })).toBeNull());
  it("null when issue date is after as-of", () =>
    expect(daysOpen({ state: "open", issueDate: "2026-12-01", finalDate: null, asOf })).toBeNull());
});
