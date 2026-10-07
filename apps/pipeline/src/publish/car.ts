import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CarWriter } from "@ipld/car";
import { MemoryBlockstore } from "blockstore-core/memory";
import { importer } from "ipfs-unixfs-importer";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import type { CID } from "multiformats/cid";

export type PackedEntry = { name: string; cid: string; size: number; sha256: string };

export type PackResult = {
  rootCid: string;
  rootBlock: { size: number; sha256: string };
  entries: PackedEntry[];
  carPath: string;
  carSize: number;
  carSha256: string;
};

/** blockstore-core v7 yields block bytes as chunk generators. */
async function collect(chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of chunks) parts.push(c);
  return Buffer.concat(parts);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Packs `files` of `dir` into a UnixFS directory DAG (CIDv1, raw leaves, 1 MiB chunks) and writes it to `<dir>/snapshot.car`. */
export async function packDirectory(dir: string, files: string[]): Promise<PackResult> {
  const blockstore = new MemoryBlockstore();
  const sorted = [...files].sort();
  const source = sorted.map((name) => ({ path: name, content: createReadStream(join(dir, name)) }));
  const cids = new Map<string, CID>();
  let root: CID | null = null;
  for await (const entry of importer(source, blockstore, {
    cidVersion: 1,
    rawLeaves: true,
    chunker: fixedSize({ chunkSize: 1_048_576 }),
    wrapWithDirectory: true,
  })) {
    if (entry.path === undefined || entry.path === "") root = entry.cid;
    else cids.set(entry.path, entry.cid);
  }
  if (!root) throw new Error("no root produced");

  const entries: PackedEntry[] = [];
  for (const name of sorted) {
    const cid = cids.get(name);
    if (!cid) throw new Error(`importer produced no entry for ${name}`);
    const path = join(dir, name);
    entries.push({ name, cid: cid.toString(), size: (await stat(path)).size, sha256: await sha256File(path) });
  }

  const rootBytes = await collect(blockstore.get(root));
  const rootBlock = { size: rootBytes.length, sha256: createHash("sha256").update(rootBytes).digest("hex") };

  const carPath = join(dir, "snapshot.car");
  const { writer, out } = CarWriter.create([root]);
  const written = pipeline(Readable.from(out), createWriteStream(carPath));
  for await (const { cid, bytes } of blockstore.getAll()) await writer.put({ cid, bytes: await collect(bytes) });
  await writer.close();
  await written;

  return {
    rootCid: root.toString(),
    rootBlock,
    entries,
    carPath,
    carSize: (await stat(carPath)).size,
    carSha256: await sha256File(carPath),
  };
}
