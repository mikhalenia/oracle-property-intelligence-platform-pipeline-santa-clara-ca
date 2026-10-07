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

/**
 * Gateways tried, in order, for in-browser Parquet reads (DuckDB-WASM needs CORS and HTTP ranges).
 * ipfs.raribleuserdata.com answered CORS `*` and 206 on 2026-10-07; the vendor gateway is last.
 */
export const SQL_GATEWAYS = ["ipfs.raribleuserdata.com", "gateway.pinata.cloud", VENDOR_GATEWAY];

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** First gateway whose ranged HEAD probe of `<root>/<path>` answers 200 or 206. */
export async function pickGateway(
  rootCid: string,
  path: string,
  fetcher: Fetcher = (url, init) => fetch(url, init),
  gateways: readonly string[] = SQL_GATEWAYS,
): Promise<string> {
  const failures: string[] = [];
  for (const g of gateways) {
    try {
      const res = await fetcher(gatewayUrl(rootCid, g, path), {
        method: "HEAD",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 200 || res.status === 206) return g;
      failures.push(`${g} ${res.status}`);
    } catch (e) {
      failures.push(`${g} ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`no gateway answered (${failures.join("; ")})`);
}
