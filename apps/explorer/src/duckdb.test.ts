import { describe, expect, it } from "vitest";
import { patchOpenPermitExample, resolveSql } from "./duckdb";

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
