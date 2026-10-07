import { describe, expect, it } from "vitest";
import { GATEWAYS, VENDOR_GATEWAY, gatewayUrl } from "./gateways";

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
