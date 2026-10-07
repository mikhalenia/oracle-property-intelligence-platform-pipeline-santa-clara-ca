const EARTH_RADIUS_MILES = 3958.7613;

export function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

export function boundingBox(center: { lat: number; lon: number }, radiusMiles: number) {
  const dLat = radiusMiles / 69.0;
  const dLon = radiusMiles / (69.0 * Math.cos((center.lat * Math.PI) / 180));
  return { minLat: center.lat - dLat, maxLat: center.lat + dLat, minLon: center.lon - dLon, maxLon: center.lon + dLon };
}

export function bboxCenter(coordinates: unknown): { lat: number; lon: number } | null {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node.length === 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      const [lon, lat] = node;
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      return;
    }
    node.forEach(walk);
  };
  walk(coordinates);
  if (!Number.isFinite(minLat)) return null;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { lat: round((minLat + maxLat) / 2), lon: round((minLon + maxLon) / 2) };
}
