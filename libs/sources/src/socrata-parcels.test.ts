import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchParcelPages, fetchParcelVersion, PARCELS_URL } from "./socrata-parcels";

const page = readFileSync(join(__dirname, "../fixtures/parcels-page.json"), "utf8");

describe("socrata parcels", () => {
  it("reads dataset version", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([{ u: "2026-08-26T16:22:37.562Z" }])));
    expect(await fetchParcelVersion(fetcher)).toBe("2026-08-26T16:22:37.562Z");
    expect(fetcher.mock.calls[0]?.[0]).toContain(encodeURIComponent("max(:updated_at)"));
  });

  it("maps rows, drops bad APNs, stores page with hash, stops on short page", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(page))
      .mockResolvedValueOnce(new Response("[]"));
    const outDir = mkdtempSync(join(tmpdir(), "parcels-"));
    const pages = [];
    for await (const p of fetchParcelPages(fetcher, {
      pageSize: 3,
      outDir,
      sourceVersion: "v1",
      fetchedAt: "2026-10-08T00:00:00Z",
    }))
      pages.push(p);
    expect(pages).toHaveLength(1);
    const [p0] = pages;
    expect(p0?.rows).toHaveLength(2);
    expect(p0?.skippedNoApn).toBe(1);
    const first = p0?.rows[0];
    expect(first?.apn).toBe("27715017");
    expect(first?.situsAddress).toBe("382 RICHMOND AV");
    expect(first?.situsCity).toBe("SAN JOSE");
    expect(first?.lat).toBeCloseTo(37.32188, 4);
    expect(first?.sourceKey).toBe("scc-parcels");
    expect(first?.sourceUrl).toBe(`${PARCELS_URL}?$order=objectid&$limit=3&$offset=0`);
    expect(first?.pageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    const second = p0?.rows[1];
    expect(second?.apn).toBe("25934037");
    expect(second?.lat).toBeCloseTo(37.305, 6);
    expect(second?.lon).toBeCloseTo(-121.895, 6);
  });

  it("retries a page whose body read fails", async () => {
    const broken = new Response(
      new ReadableStream({
        start(c) {
          c.error(new TypeError("terminated"));
        },
      }),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(new Response(page))
      .mockResolvedValueOnce(new Response("[]"));
    const pages = [];
    for await (const p of fetchParcelPages(fetcher, {
      pageSize: 3,
      outDir: mkdtempSync(join(tmpdir(), "parcels-")),
      sourceVersion: "v1",
      fetchedAt: "2026-10-08T00:00:00Z",
      baseDelayMs: 1,
    }))
      pages.push(p);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.rows).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0]).toBe(fetcher.mock.calls[1]?.[0]);
  });
});
