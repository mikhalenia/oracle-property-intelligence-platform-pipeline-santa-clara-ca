import { describe, expect, it } from "vitest";
import { normalizeApn } from "./apn";

describe("normalizeApn", () => {
  it("accepts 8 digits", () => expect(normalizeApn("27715017")).toBe("27715017"));
  it("accepts dashed form", () => expect(normalizeApn("277-15-017")).toBe("27715017"));
  it("trims whitespace", () => expect(normalizeApn(" 27715017 ")).toBe("27715017"));
  it("rejects scientific notation", () => expect(normalizeApn("2.7715017E7")).toBeNull());
  it("rejects short, empty, null", () => {
    expect(normalizeApn("1234567")).toBeNull();
    expect(normalizeApn("")).toBeNull();
    expect(normalizeApn(null)).toBeNull();
  });
  it("rejects 9+ digits", () => expect(normalizeApn("277150170")).toBeNull());
});
