import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest";

describe("buildManifest", () => {
  it("lists root, files and car with required fields", () => {
    const m = buildManifest({
      runId: "r1",
      previousManifestCid: null,
      publishedAt: "2026-10-08T02:00:00Z",
      root: { cid: "bafyroot", size: 10, sha256: "00" },
      entries: [{ name: "leads.parquet", cid: "bafyleads", size: 5, sha256: "aa" }],
      car: { cid: "bafycar", size: 100, sha256: "cc" },
    });
    expect(m.schema).toBe("scc-manifest/1");
    expect(m.artifacts).toEqual([
      { cid: "bafyroot", name: "snapshot", path: "/", size: 10, codec: "directory", sha256: "00" },
      { cid: "bafyleads", name: "leads.parquet", path: "/leads.parquet", size: 5, codec: "file", sha256: "aa" },
    ]);
    expect(m.car).toEqual({
      cid: "bafycar",
      name: "r1.car",
      path: "/r1.car",
      size: 100,
      codec: "file",
      sha256: "cc",
      root: "bafyroot",
    });
    expect(m.fips).toBe("06085");
  });
});
