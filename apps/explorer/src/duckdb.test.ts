import { describe, expect, it } from "vitest";
import { cell, patchOpenPermitExample, resolveSql } from "./duckdb";

describe("resolveSql", () => {
  it("replaces every {{base}} occurrence", () => {
    const sql = "SELECT * FROM '{{base}}/a.parquet' JOIN '{{base}}/b.parquet'";
    expect(resolveSql(sql, "https://g/ipfs/cid")).toBe(
      "SELECT * FROM 'https://g/ipfs/cid/a.parquet' JOIN 'https://g/ipfs/cid/b.parquet'",
    );
  });
});

describe("patchOpenPermitExample", () => {
  it("widens permit_state = 'open' to include expired_unfinaled", () => {
    expect(patchOpenPermitExample("WHERE permit_state = 'open' AND x")).toBe(
      "WHERE permit_state IN ('open','expired_unfinaled') AND x",
    );
  });
  it("leaves already patched SQL untouched", () => {
    const s = "WHERE permit_state IN ('open','expired_unfinaled')";
    expect(patchOpenPermitExample(s)).toBe(s);
  });
});

describe("cell", () => {
  it("stringifies nested BigInt and ISO-formats Dates", () => {
    const out = cell({ a: [1n, { b: 2n }], d: new Date("2026-01-02T03:04:05Z") });
    expect(out).toEqual({ a: ["1", { b: "2" }], d: "2026-01-02T03:04:05.000Z" });
    expect(() => JSON.stringify(out)).not.toThrow();
  });
  it("renders temporal numbers as ISO strings", () => {
    expect(cell(Date.UTC(2026, 0, 2), true)).toBe("2026-01-02T00:00:00.000Z");
  });
});
