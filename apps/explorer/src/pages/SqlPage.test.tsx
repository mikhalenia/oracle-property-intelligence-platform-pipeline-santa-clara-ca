import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SqlPage } from "./SqlPage";
import * as api from "../api";
import * as duck from "../duckdb";

vi.mock("../api");
vi.mock("../duckdb", async (orig) => ({
  ...(await orig<typeof duck>()),
  runSql: vi.fn(),
  loadExamples: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api.getManifest).mockResolvedValue({
    runId: "r1",
    manifestCid: "m",
    manifestUrl: "u",
    manifest: {
      artifacts: [
        { cid: "bafyroot", name: "exports", path: "e", size: 1, codec: "directory", sha256: "x" },
      ],
    } as never,
  });
  vi.mocked(duck.loadExamples).mockResolvedValue([
    { id: "a", title: "Example A", sql: "SELECT * FROM '{{base}}/leads.parquet'" },
  ]);
  vi.mocked(duck.runSql).mockResolvedValue({ columns: ["n"], rows: [[1]] });
});

describe("SqlPage", () => {
  it("fills the editor from the picker and runs resolved SQL", async () => {
    render(<SqlPage />);
    await waitFor(() => expect(duck.loadExamples).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Example A" }));
    const editor = screen.getByRole("textbox", { name: /sql/i });
    expect(editor).toHaveValue("SELECT * FROM '{{base}}/leads.parquet'");
    await userEvent.click(screen.getByRole("button", { name: /run/i }));
    await waitFor(() =>
      expect(duck.runSql).toHaveBeenCalledWith(
        "SELECT * FROM 'https://ipfs.filebase.io/ipfs/bafyroot/leads.parquet'",
      ),
    );
    expect(await screen.findByText(/1 row/)).toBeInTheDocument();
  });
});
