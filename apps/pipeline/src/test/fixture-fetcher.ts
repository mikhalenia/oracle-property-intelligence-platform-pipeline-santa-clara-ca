import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetcher } from "@scc/sources";

const CSV_FILES: Record<string, string> = {
  "buildingpermitsactive.csv": "active.csv",
  "buildingpermitsunderinspection.csv": "under_inspection.csv",
  "buildingpermitsexpired.csv": "expired.csv",
  "buildingpermits30.csv": "last_30_days.csv",
};
const PACKAGE_KEYS: Record<string, string> = {
  "active-building-permits": "sj-permits-active",
  "building-permits-under-inspection": "sj-permits-under_inspection",
  "expired-building-permits": "sj-permits-expired",
  "last-30-days-building-permits": "sj-permits-last_30_days",
};

const notFound = () => new Response("not found", { status: 404 });

/** Serves a fixture directory (versions.json, parcels-page.json, *.csv) in place of the live sources. */
export function fixtureFetcher(dir: string): Fetcher {
  const read = (name: string) => readFileSync(join(dir, name));
  const versions = () =>
    JSON.parse(read("versions.json").toString("utf8")) as Record<string, string>;
  return async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "data.sccgov.org") {
      if (url.searchParams.has("$select")) return Response.json([{ u: versions()["scc-parcels"] }]);
      const offset = Number(url.searchParams.get("$offset") ?? "0");
      return offset === 0 ? new Response(read("parcels-page.json")) : Response.json([]);
    }
    if (url.hostname === "data.sanjoseca.gov") {
      if (url.pathname === "/api/3/action/package_show") {
        const key = PACKAGE_KEYS[url.searchParams.get("id") ?? ""];
        if (!key) return notFound();
        return Response.json({
          result: { resources: [{ format: "CSV", last_modified: versions()[key] }] },
        });
      }
      const file = CSV_FILES[url.pathname.split("/").pop() ?? ""];
      return file ? new Response(read(file)) : notFound();
    }
    return notFound();
  };
}
