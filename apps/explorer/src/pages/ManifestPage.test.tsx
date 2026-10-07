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
