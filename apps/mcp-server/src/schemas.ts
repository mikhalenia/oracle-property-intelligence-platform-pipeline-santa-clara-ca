import { z } from "zod";

/** Query-string aware boolean: accepts true/false and "true"/"false"/"1"/"0". */
const boolish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

const center = {
  lat: z.coerce
    .number()
    .min(36.9)
    .max(37.5)
    .describe("Center latitude (WGS84), Santa Clara County: 36.9 to 37.5"),
  lon: z.coerce
    .number()
    .min(-122.3)
    .max(-121.2)
    .describe("Center longitude (WGS84), Santa Clara County: -122.3 to -121.2"),
  radiusMiles: z.coerce
    .number()
    .min(0.5)
    .max(25)
    .default(5)
    .describe("Search radius in miles (0.5 to 25, default 5)"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(200)
    .describe("Maximum rows returned (1 to 500, default 200)"),
};

export const RadiusQuery = z.object(center);

export const AgedRoofsQuery = z.object({
  ...center,
  minRoofAgeYears: z.coerce
    .number()
    .int()
    .min(5)
    .max(40)
    .default(15)
    .describe("Minimum estimated roof age in years (5 to 40, default 15)"),
});

export const PermitStateFilter = z.enum(["open", "expired_unfinaled", "any"]);

export const OpenPermitsQuery = z.object({
  ...center,
  state: PermitStateFilter.default("any").describe(
    "open = issued and still active; expired_unfinaled = expired without a final inspection (stalled); any = both. Finaled permits and permits whose approvals are Complete are never returned. Default any",
  ),
  minOpenYears: z.coerce
    .number()
    .min(0)
    .max(20)
    .default(0)
    .describe("Minimum years since issue without a final inspection (0 to 20, default 0)"),
  roofingOnly: boolish.default(true).describe("Only roofing permits (default true)"),
});

export const ApnParam = z.object({
  apn: z.string().min(1).describe("Assessor parcel number (APN)"),
});
export const ContractorParam = z.object({
  id: z.string().min(1).describe("Normalized contractor id"),
});

export type RadiusParams = z.output<typeof RadiusQuery>;
export type AgedRoofsParams = z.output<typeof AgedRoofsQuery>;
export type OpenPermitsParams = z.output<typeof OpenPermitsQuery>;
