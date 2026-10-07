import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applySchema, openDb } from "../db/duck";
import { packDirectory } from "../publish/car";
import { recordVerification, verifyManifest, type VerificationReport } from "./verify";

const HELLO = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const file = {
  cid: "bafyfile",
  name: "a.txt",
  path: "/a.txt",
  size: 5,
  codec: "file",
  sha256: HELLO,
};
const manifest = {
  schema: "scc-manifest/1",
  runId: "r1",
  artifacts: [file],
  car: { ...file, cid: "bafycar", name: "r1.car", path: "/r1.car", root: "bafyfile" },
} as never;

describe("verifyManifest", () => {
  it("passes when two independent gateways return matching bytes", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes("ipfs.filebase.io") || url.includes("dweb.link") || url.includes("ipfs.io")
        ? new Response("hello")
        : new Response("nope", { status: 429 }),
    );
    const report = await verifyManifest(manifest, fetcher, {
      gateways: ["ipfs.filebase.io", "dweb.link", "ipfs.io", "w3s.link"],
      retries: 0,
    });
    expect(report.ok).toBe(true);
    expect(report.artifacts[0]?.independentOk).toBe(2);
    const bad = report.artifacts[0]?.results.find((r) => r.gateway === "w3s.link");
    expect(bad).toMatchObject({
      status: 429,
      sha256Match: false,
      note: expect.stringContaining("nope"),
    });
  });

  it("fails when only the vendor gateway and one other succeed", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes("ipfs.filebase.io") || url.includes("dweb.link")
        ? new Response("hello")
        : new Response("nope", { status: 429 }),
    );
    const report = await verifyManifest(manifest, fetcher, {
      gateways: ["ipfs.filebase.io", "dweb.link", "ipfs.io"],
      retries: 0,
    });
    expect(report.ok).toBe(false);
    expect(report.artifacts[0]?.independentOk).toBe(1);
  });

  it("fails on digest mismatch", async () => {
    const fetcher = vi.fn(async () => new Response("hellx"));
    const report = await verifyManifest(manifest, fetcher, {
      gateways: ["dweb.link", "ipfs.io"],
      retries: 0,
    });
    expect(report.ok).toBe(false);
  });

  it("counts a 429 followed by 200 on the same gateway as served", async () => {
    const calls: Record<string, number> = {};
    const fetcher = vi.fn(async (url: string) => {
      calls[url] = (calls[url] ?? 0) + 1;
      return calls[url] === 1 ? new Response("slow", { status: 429 }) : new Response("hello");
    });
    const report = await verifyManifest(manifest, fetcher, {
      gateways: ["dweb.link", "ipfs.io"],
      retries: 1,
      backoffMs: 0,
    });
    expect(report.ok).toBe(true);
    expect(report.artifacts[0]?.independentOk).toBe(2);
  });

  it("does not retry a 404", async () => {
    const fetcher = vi.fn(async () => new Response("missing", { status: 404 }));
    const report = await verifyManifest(manifest, fetcher, {
      gateways: ["dweb.link"],
      retries: 2,
      backoffMs: 0,
    });
    expect(report.ok).toBe(false);
    // 2 artifacts (file + car), one gateway, one call each
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("verifies a directory root via a real CAR, and rejects a CAR with another root", async () => {
    const mk = async (content: string) => {
      const dir = mkdtempSync(join(tmpdir(), "verify-"));
      writeFileSync(join(dir, "a.txt"), content);
      const packed = await packDirectory(dir, ["a.txt"]);
      return { packed, car: readFileSync(packed.carPath) };
    };
    const good = await mk("hello");
    const other = await mk("different");
    const dirManifest = {
      schema: "scc-manifest/1",
      runId: "r2",
      artifacts: [
        {
          cid: good.packed.rootCid,
          name: "snapshot",
          path: "/",
          size: good.packed.rootBlock.size,
          codec: "directory",
          sha256: good.packed.rootBlock.sha256,
        },
      ],
      car: { ...file, root: good.packed.rootCid, cid: "bafycar" },
    } as never;
    const serve = (car: Buffer) =>
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("format=car")) {
          expect((init?.headers as Record<string, string>)["accept"]).toBe(
            "application/vnd.ipld.car",
          );
          return new Response(car);
        }
        return new Response("hello");
      });
    const ok = await verifyManifest(dirManifest, serve(good.car), {
      gateways: ["dweb.link", "ipfs.io"],
      retries: 0,
    });
    expect(ok.artifacts[0]?.independentOk).toBe(2);
    expect(ok.ok).toBe(true);
    const bad = await verifyManifest(dirManifest, serve(other.car), {
      gateways: ["dweb.link", "ipfs.io"],
      retries: 0,
    });
    expect(bad.artifacts[0]?.independentOk).toBe(0);
    expect(bad.ok).toBe(false);
  });

  it("rejects a directory CAR whose root block differs from the manifest's size or sha256", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    writeFileSync(join(dir, "a.txt"), "hello");
    const packed = await packDirectory(dir, ["a.txt"]);
    const car = readFileSync(packed.carPath);
    const entry = (over: Record<string, unknown>) =>
      ({
        schema: "scc-manifest/1",
        runId: "r2",
        artifacts: [
          {
            cid: packed.rootCid,
            name: "snapshot",
            path: "/",
            size: packed.rootBlock.size,
            codec: "directory",
            sha256: packed.rootBlock.sha256,
            ...over,
          },
        ],
        car: { ...file, root: packed.rootCid, cid: "bafycar" },
      }) as never;
    const serve = vi.fn(async (url: string) =>
      url.includes("format=car") ? new Response(car) : new Response("hello"),
    );
    const opts = { gateways: ["dweb.link"], retries: 0, minIndependent: 1 };
    expect((await verifyManifest(entry({}), serve, opts)).ok).toBe(true);
    const badSha = await verifyManifest(entry({ sha256: "0".repeat(64) }), serve, opts);
    expect(badSha.ok).toBe(false);
    expect(badSha.artifacts[0]?.results[0]?.note).toMatch(/root block sha256/);
    const badSize = await verifyManifest(entry({ size: packed.rootBlock.size + 1 }), serve, opts);
    expect(badSize.ok).toBe(false);
    expect(badSize.artifacts[0]?.results[0]?.note).toMatch(/root block size/);
  });
});

describe("recordVerification", () => {
  it("writes the report next to the export, into docs/runs and into the DuckDB run record", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    await db.run(
      `INSERT INTO runs VALUES ('r1','2026-10-01 00:00:00',NULL,'2026-10-01','complete','{"runId":"r1","status":"complete"}','bafym',NULL)`,
    );
    const exportDir = mkdtempSync(join(tmpdir(), "exp-"));
    mkdirSync(join(exportDir, "r1"));
    const docsRunsDir = mkdtempSync(join(tmpdir(), "runs-"));
    writeFileSync(
      join(docsRunsDir, "r1.json"),
      JSON.stringify({ runId: "r1", manifestCid: "bafym" }),
    );
    const report: VerificationReport = {
      runId: "r1",
      verifiedAt: "2026-10-01T01:00:00Z",
      ok: true,
      minIndependent: 2,
      gateways: ["dweb.link"],
      artifacts: [],
    };
    await recordVerification({ db, runId: "r1", report, exportDir, docsRunsDir });
    expect(JSON.parse(readFileSync(join(exportDir, "r1", "verification.json"), "utf8"))).toEqual(
      report,
    );
    expect(JSON.parse(readFileSync(join(docsRunsDir, "r1.json"), "utf8"))).toEqual({
      runId: "r1",
      manifestCid: "bafym",
      verification: report,
    });
    const row = (
      await db.all<{ record: string }>("SELECT record::TEXT AS record FROM runs WHERE run_id='r1'")
    )[0]!;
    expect(JSON.parse(row.record)).toEqual({
      runId: "r1",
      status: "complete",
      verification: report,
    });
    await db.close();
  });
});
