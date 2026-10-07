export type Artifact = {
  cid: string;
  name: string;
  path: string;
  size: number;
  codec: "file" | "directory";
  sha256: string;
};
export type Manifest = {
  schema: "scc-manifest/1";
  runId: string;
  publishedAt: string;
  county: "Santa Clara";
  state: "CA";
  fips: "06085";
  previousManifestCid: string | null;
  artifacts: Artifact[];
  car: Artifact & { root: string };
  gatewayUrlTemplate: "https://{gateway}/ipfs/{cid}";
  ipns: null;
};

type Hashed = { size: number; sha256: string };

export function buildManifest(input: {
  runId: string;
  previousManifestCid: string | null;
  publishedAt: string;
  root: Hashed & { cid: string };
  entries: Array<Hashed & { name: string; cid: string }>;
  car: Hashed & { cid: string };
}): Manifest {
  return {
    schema: "scc-manifest/1",
    runId: input.runId,
    publishedAt: input.publishedAt,
    county: "Santa Clara",
    state: "CA",
    fips: "06085",
    previousManifestCid: input.previousManifestCid,
    artifacts: [
      { cid: input.root.cid, name: "snapshot", path: "/", size: input.root.size, codec: "directory", sha256: input.root.sha256 },
      ...input.entries.map((e) => ({
        cid: e.cid,
        name: e.name,
        path: `/${e.name}`,
        size: e.size,
        codec: "file" as const,
        sha256: e.sha256,
      })),
    ],
    car: {
      cid: input.car.cid,
      name: `${input.runId}.car`,
      path: `/${input.runId}.car`,
      size: input.car.size,
      codec: "file",
      sha256: input.car.sha256,
      root: input.root.cid,
    },
    gatewayUrlTemplate: "https://{gateway}/ipfs/{cid}",
    ipns: null,
  };
}
