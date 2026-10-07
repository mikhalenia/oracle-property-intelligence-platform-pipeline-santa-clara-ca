/** Independent public IPFS gateways (probed 2026-10-07). Some answer 429 "service worker gateway"; the report documents that. */
export const PUBLIC_GATEWAYS = [
  "gateway.pinata.cloud",
  "ipfs.ssi.eecc.de",
  "ipfs.raribleuserdata.com",
  "dweb.link",
  "ipfs.io",
  "w3s.link",
];

/** Gateways operated by the pinning vendor; they do not count as independent. */
export const VENDOR_GATEWAYS = ["ipfs.filebase.io"];
