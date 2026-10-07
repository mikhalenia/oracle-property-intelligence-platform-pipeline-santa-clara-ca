import { describe, expect, it } from "vitest";
import { parseUsDate } from "./dates";

describe("parseUsDate", () => {
  it("parses M/D/YYYY with time", () => expect(parseUsDate("8/14/2026 12:00:00 AM")).toBe("2026-08-14"));
  it("parses MM/DD/YYYY", () => expect(parseUsDate("03/11/1986")).toBe("1986-03-11"));
  it("returns null for empty or garbage", () => {
    expect(parseUsDate("")).toBeNull();
    expect(parseUsDate(null)).toBeNull();
    expect(parseUsDate("not a date")).toBeNull();
  });
});
