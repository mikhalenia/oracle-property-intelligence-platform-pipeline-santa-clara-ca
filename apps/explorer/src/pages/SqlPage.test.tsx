import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SqlPage } from "./SqlPage";
import * as api from "../api";
import * as duck from "../duckdb";

vi.mock("@uiw/react-codemirror", () => ({
  __esModule: true,
  EditorView: { contentAttributes: { of: () => [] } },
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="SQL" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@codemirror/lang-sql", () => ({ sql: () => [] }));
vi.mock("../api");
vi.mock("../gateways", async (orig) => ({
  ...(await orig<typeof import("../gateways")>()),
  pickGateway: vi.fn(async () => "ipfs.raribleuserdata.com"),
}));
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
    const editor = await screen.findByRole("textbox", { name: /sql/i });
    expect(editor).toHaveValue("SELECT * FROM '{{base}}/leads.parquet'");
    await userEvent.click(screen.getByRole("button", { name: /run/i }));
    await waitFor(() =>
      expect(duck.runSql).toHaveBeenCalledWith(
        "SELECT * FROM 'https://ipfs.raribleuserdata.com/ipfs/bafyroot/leads.parquet'",
      ),
    );
    expect(await screen.findByText(/1 row/)).toBeInTheDocument();
    expect(screen.getByText("ipfs.raribleuserdata.com")).toBeInTheDocument();
  });

  it("shows the local-copy notice and snapshot line", async () => {
    render(<SqlPage />);
    expect(
      screen.getByText(/Queries run in a local, in-memory DuckDB copy inside your browser/),
    ).toBeInTheDocument();
    expect(screen.getByText(/reloading the page resets everything/)).toBeInTheDocument();
    expect(await screen.findByText("bafyroot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "copy bafyroot" })).toBeInTheDocument();
  });

  it("runs the edited text on Ctrl+Enter", async () => {
    render(<SqlPage />);
    await screen.findByText("bafyroot");
    const editor = await screen.findByRole("textbox", { name: /sql/i });
    await userEvent.type(editor, "SELECT 2");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(duck.runSql).toHaveBeenCalledWith("SELECT 2"));
  });
});
