import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManifestPage } from "./ManifestPage";
import * as api from "../api";

vi.mock("../api");

const manifest = {
  schema: "scc-manifest/1",
  runId: "r1",
  publishedAt: "2026-10-07T18:00:00Z",
  county: "Santa Clara",
  state: "CA",
  fips: "06085",
  previousManifestCid: "bafyprev",
  artifacts: [
    {
      cid: "bafyroot",
      name: "exports",
      path: "exports",
      size: 2048,
      codec: "directory" as const,
      sha256: "a".repeat(64),
    },
    {
      cid: "bafyfile",
      name: "manifest-note.txt",
      path: "n.txt",
      size: 10,
      codec: "file" as const,
      sha256: "b".repeat(64),
    },
  ],
  car: { cid: "bafycar", name: "r1.car", size: 4096, sha256: "c".repeat(64), root: "bafyroot" },
  gatewayUrlTemplate: "https://{gateway}/ipfs/{cid}",
  ipns: null,
};

beforeEach(() => {
  vi.mocked(api.getRuns).mockResolvedValue([]);
});

describe("ManifestPage", () => {
  it("renders artifact rows with gateway links and pending verification", async () => {
    vi.mocked(api.getManifest).mockResolvedValue({
      runId: "r1",
      manifestCid: "bafym",
      manifestUrl: "https://x",
      manifest,
    });
    render(<ManifestPage />);
    expect(await screen.findByText("manifest-note.txt")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "gateway.pinata.cloud" });
    expect(
      links.some((l) => l.getAttribute("href") === "https://gateway.pinata.cloud/ipfs/bafyfile"),
    ).toBe(true);
    expect(screen.getByText("r1.car")).toBeInTheDocument();
    expect(screen.getByText(/verification pending/i)).toBeInTheDocument();
  });

  it("renders the verification matrix with independent-gateway counts from the run record", async () => {
    vi.mocked(api.getManifest).mockResolvedValue({
      runId: "r1",
      manifestCid: "bafym",
      manifestUrl: "https://x",
      manifest,
    });
    vi.mocked(api.getRuns).mockResolvedValue([
      {
        runId: "r1",
        verification: {
          runId: "r1",
          verifiedAt: "2026-10-07T19:00:00Z",
          ok: true,
          minIndependent: 2,
          gateways: ["dweb.link", "ipfs.io"],
          artifacts: [
            {
              cid: "bafyfile",
              name: "verified-note.txt",
              codec: "file",
              size: 10,
              independentOk: 2,
              results: [
                { gateway: "dweb.link", status: 200, bytes: 10, sha256Match: true, ms: 5 },
                { gateway: "ipfs.io", status: 200, bytes: 10, sha256Match: true, ms: 6 },
              ],
            },
          ],
        },
      } as never,
    ]);
    render(<ManifestPage />);
    expect(await screen.findByText("verified-note.txt")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.queryByText(/verification pending/i)).not.toBeInTheDocument();
  });

  it("shows pending/error text when manifest is null", async () => {
    vi.mocked(api.getManifest).mockResolvedValue({
      runId: "r1",
      manifestCid: "bafym",
      manifestUrl: "https://x",
      manifest: null,
      error: "fetch failed",
    });
    render(<ManifestPage />);
    expect(await screen.findByText(/fetch failed/)).toBeInTheDocument();
  });
});
