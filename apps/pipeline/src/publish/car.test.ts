import { createReadStream, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CarReader } from "@ipld/car";
import { CID } from "multiformats/cid";
import { describe, expect, it } from "vitest";
import { packDirectory } from "./car";

describe("packDirectory", () => {
  it("produces a CIDv1 base32 root, per-file CIDs and a CAR, deterministically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "car-"));
    writeFileSync(join(dir, "a.txt"), "hello");
    writeFileSync(join(dir, "b.json"), "{}");
    const r1 = await packDirectory(dir, ["a.txt", "b.json"]);
    const r2 = await packDirectory(dir, ["a.txt", "b.json"]);
    expect(r1.rootCid).toMatch(/^bafy[a-z2-7]{50,}$/);
    expect(r1.rootCid).toBe(r2.rootCid);
    expect(r1.entries.map((e) => e.name)).toEqual(["a.txt", "b.json"]);
    expect(r1.entries[0]).toMatchObject({
      size: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    expect(r1.entries[0]?.cid).toMatch(/^baf[a-z2-7]+$/);
    expect(r1.carSha256).toBe(r2.carSha256);
    expect(r1.carSize).toBeGreaterThan(0);
    expect(r1.carSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.rootBlock.size).toBeGreaterThan(0);
    expect(r1.rootBlock.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes every block under its real CID with the directory as dag-pb root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "car-"));
    writeFileSync(join(dir, "big.bin"), Buffer.alloc(2_500_000, 7));
    writeFileSync(join(dir, "a.txt"), "hello");
    const r = await packDirectory(dir, ["big.bin", "a.txt"]);
    const reader = await CarReader.fromIterable(createReadStream(r.carPath));
    expect((await reader.getRoots()).map(String)).toEqual([r.rootCid]);
    expect(await reader.has(CID.parse(r.rootCid))).toBe(true);
    expect(CID.parse(r.rootCid).code).toBe(0x70);
    let n = 0;
    for await (const { cid } of reader.blocks()) {
      n++;
      expect([0x55, 0x70]).toContain(cid.code);
    }
    expect(n).toBeGreaterThan(4);
    for (const e of r.entries) expect(await reader.has(CID.parse(e.cid))).toBe(true);
  });
});
