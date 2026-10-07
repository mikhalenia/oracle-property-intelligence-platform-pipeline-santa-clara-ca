import { describe, expect, it } from "vitest";
import { bboxCenter, boundingBox, haversineMiles } from "./geo";

describe("geo", () => {
  const sanJose = { lat: 37.3382, lon: -121.8863 };
  const paloAlto = { lat: 37.4419, lon: -122.143 };
  it("haversine San Jose to Palo Alto is about 16 miles", () =>
    expect(haversineMiles(sanJose, paloAlto)).toBeCloseTo(16.0, 0));
  it("bounding box contains the circle", () => {
    const b = boundingBox(sanJose, 5);
    expect(b.minLat).toBeLessThan(sanJose.lat);
    expect(b.maxLat).toBeGreaterThan(sanJose.lat);
    expect(b.maxLat - b.minLat).toBeCloseTo(0.1449, 3);
  });
  it("bboxCenter of a MultiPolygon", () =>
    expect(
      bboxCenter([[[[-121.92, 37.32], [-121.92, 37.3218], [-121.9227, 37.3218], [-121.9227, 37.32], [-121.92, 37.32]]]]),
    ).toEqual({ lat: 37.3209, lon: -121.92135 }));
  it("bboxCenter of empty is null", () => expect(bboxCenter([])).toBeNull());
});
