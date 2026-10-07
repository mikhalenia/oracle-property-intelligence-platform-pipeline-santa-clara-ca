export const VENDOR_GATEWAY = "ipfs.filebase.io";
export const GATEWAYS = [
  "gateway.pinata.cloud",
  "ipfs.ssi.eecc.de",
  "ipfs.raribleuserdata.com",
  VENDOR_GATEWAY,
] as const;

export function gatewayUrl(cid: string, gateway: string, path?: string): string {
  const suffix = path ? `/${path.replace(/^\/+/, "")}` : "";
  return `https://${gateway}/ipfs/${cid}${suffix}`;
}
