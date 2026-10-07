import { describe, expect, it, vi } from "vitest";
import { GATEWAYS, SQL_GATEWAYS, VENDOR_GATEWAY, gatewayUrl, pickGateway } from "./gateways";

describe("gatewayUrl", () => {
  it("builds https://<gateway>/ipfs/<cid>", () => {
    expect(gatewayUrl("bafyX", "gateway.pinata.cloud")).toBe(
      "https://gateway.pinata.cloud/ipfs/bafyX",
    );
  });
  it("appends a path without double slashes", () => {
    expect(gatewayUrl("bafyX", VENDOR_GATEWAY, "/leads.parquet")).toBe(
      "https://ipfs.filebase.io/ipfs/bafyX/leads.parquet",
    );
    expect(gatewayUrl("bafyX", VENDOR_GATEWAY, "leads.parquet")).toBe(
      "https://ipfs.filebase.io/ipfs/bafyX/leads.parquet",
    );
  });
  it("lists the three public gateways plus the vendor", () => {
    expect(GATEWAYS).toEqual([
      "gateway.pinata.cloud",
      "ipfs.ssi.eecc.de",
      "ipfs.raribleuserdata.com",
      "ipfs.filebase.io",
    ]);
  });
});

describe("pickGateway", () => {
  it("orders rarible, pinata, then the vendor gateway", () => {
    expect(SQL_GATEWAYS).toEqual([
      "ipfs.raribleuserdata.com",
      "gateway.pinata.cloud",
      "ipfs.filebase.io",
    ]);
  });

  it("returns the first gateway answering a ranged HEAD probe with 200/206", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes("raribleuserdata")
        ? new Response(null, { status: 429 })
        : new Response(null, { status: 206 }),
    );
    expect(await pickGateway("bafyroot", "leads.parquet", fetcher)).toBe("gateway.pinata.cloud");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://ipfs.raribleuserdata.com/ipfs/bafyroot/leads.parquet",
      expect.objectContaining({ method: "HEAD", headers: { Range: "bytes=0-0" } }),
    );
  });

  it("skips gateways that throw and fails when none answer", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("filebase")) return new Response(null, { status: 200 });
      throw new TypeError("network error");
    });
    expect(await pickGateway("bafyroot", "leads.parquet", fetcher)).toBe("ipfs.filebase.io");
    const none = vi.fn(async () => new Response(null, { status: 504 }));
    await expect(pickGateway("bafyroot", "leads.parquet", none)).rejects.toThrow(
      /no gateway answered/,
    );
  });
});
