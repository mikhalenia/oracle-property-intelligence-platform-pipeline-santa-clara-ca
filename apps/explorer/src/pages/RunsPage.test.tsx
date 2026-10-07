import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunsPage } from "./RunsPage";
import * as api from "../api";

vi.mock("../api");

const run = {
  runId: "2026-10-07T17-10-54Z",
  startedAt: "2026-10-07T17:10:54Z",
  finishedAt: "2026-10-07T17:20:00Z",
  asOf: "2026-10-07",
  status: "complete",
  sources: {
    "scc-parcels": {
      fetched: 100,
      inserted: 5,
      updated: 2,
      unchanged: 93,
      removed: 0,
      sourceVersion: "v1",
      skipped: false,
    },
  },
  totals: {
    properties: 123456,
    permits: 789,
    roofingPermits: 42,
    contractors: 7,
    owners: 9,
    roofAge: 11,
  },
  limitations: ["CSLB portal returned 503"],
  previousRunId: null,
  manifestCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
};

beforeEach(() => {
  vi.mocked(api.getHealth).mockResolvedValue({
    ok: true,
    snapshot: { runId: run.runId, manifestCid: run.manifestCid, syncedAt: "2026-10-07T18:00:00Z" },
  });
});

describe("RunsPage", () => {
  it("renders run id, totals and limitations", async () => {
    vi.mocked(api.getRuns).mockResolvedValue([run]);
    render(<RunsPage />);
    expect((await screen.findAllByText(run.runId)).length).toBeGreaterThan(0);
    expect(screen.getByText("123,456")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(await screen.findByText("CSLB portal returned 503")).toBeInTheDocument();
    expect(screen.getByText("scc-parcels")).toBeInTheDocument();
  });

  it("shows an empty state when there are no runs", async () => {
    vi.mocked(api.getRuns).mockResolvedValue([]);
    vi.mocked(api.getHealth).mockResolvedValue({ ok: true, snapshot: null });
    render(<RunsPage />);
    expect(await screen.findByText(/no runs/i)).toBeInTheDocument();
  });
});
