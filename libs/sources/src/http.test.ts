import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./http";
import { sha256Hex } from "./hash";
import { recordHash } from "./provenance";

describe("sha256Hex", () => {
  it("hashes strings and bytes identically", () => {
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256Hex("abc")).toBe(expected);
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(expected);
  });
});

describe("recordHash", () => {
  it("ignores provenance fields", () => {
    const base = { apn: "1", n: 2 };
    const a = {
      ...base,
      sourceKey: "k",
      sourceUrl: "u",
      sourceVersion: "v",
      fetchedAt: "t1",
      pageSha256: "p1",
      recordHash: "x",
    };
    const b = {
      ...base,
      sourceKey: "k",
      sourceUrl: "u",
      sourceVersion: "v",
      fetchedAt: "t2",
      pageSha256: "p2",
    };
    expect(recordHash(a)).toBe(recordHash(b));
    expect(recordHash(a)).not.toBe(recordHash({ ...base, n: 3 }));
  });
});

describe("fetchWithRetry", () => {
  it("retries on 503 then succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await fetchWithRetry(fetcher, "https://x", undefined, {
      retries: 2,
      baseDelayMs: 1,
    });
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("throws after exhausting retries", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    await expect(
      fetchWithRetry(fetcher, "https://x", undefined, { retries: 1, baseDelayMs: 1 }),
    ).rejects.toThrow(/503/);
  });
  it("does not retry 404", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("no", { status: 404 }));
    await expect(
      fetchWithRetry(fetcher, "https://x", undefined, { retries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow(/404/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
