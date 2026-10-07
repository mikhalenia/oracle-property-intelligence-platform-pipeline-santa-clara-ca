import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { getManifest } from "../api";
import {
  baseFor,
  loadExamples,
  resolveSql,
  runSql,
  type SqlExample,
  type SqlResult,
} from "../duckdb";

const show = (v: unknown) =>
  v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

export function SqlPage() {
  const [base, setBase] = useState<string | null>(null);
  const [examples, setExamples] = useState<SqlExample[]>([]);
  const [selected, setSelected] = useState("");
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<(SqlResult & { ms: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const m = await getManifest();
      const root =
        m.manifest?.artifacts.find((a) => a.codec === "directory") ?? m.manifest?.artifacts[0];
      if (!root) throw new Error(m.error ?? "no manifest published yet");
      if (!live) return;
      setBase(baseFor(root.cid));
      setExamples(await loadExamples(root.cid));
    })().catch(
      (e: unknown) =>
        live && setNotice(`Examples unavailable: ${e instanceof Error ? e.message : String(e)}`),
    );
    return () => {
      live = false;
    };
  }, []);

  const pick = (id: string) => {
    setSelected(id);
    const ex = examples.find((e) => e.id === id);
    if (ex) setSql(ex.sql);
  };

  const run = async () => {
    if (!base) return;
    setRunning(true);
    setError(null);
    const t0 = performance.now();
    try {
      const r = await runSql(resolveSql(sql, base));
      setResult({ ...r, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="h5">SQL</Typography>
      <Alert severity="info">
        DuckDB-WASM in your browser reading {base ?? "<gateway>/ipfs/<rootCid>"}/leads.parquet — no
        server database
      </Alert>
      {notice && <Alert severity="warning">{notice}</Alert>}
      <TextField
        select
        label="Example"
        value={selected}
        onChange={(e) => pick(e.target.value)}
        size="small"
        disabled={examples.length === 0}
      >
        {examples.map((e) => (
          <MenuItem key={e.id} value={e.id}>
            {e.title}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="SQL"
        multiline
        minRows={6}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        slotProps={{ htmlInput: { style: { fontFamily: "monospace" } } }}
      />
      <div>
        <Button
          variant="contained"
          onClick={() => void run()}
          disabled={running || !base || sql.trim() === ""}
        >
          {running ? "Running…" : "Run"}
        </Button>
      </div>
      {error && (
        <Alert severity="error" sx={{ whiteSpace: "pre-wrap" }}>
          {error}
        </Alert>
      )}
      {result && (
        <>
          <Typography variant="body2">
            {result.rows.length} {result.rows.length === 1 ? "row" : "rows"} · {result.ms} ms
          </Typography>
          {result.rows.length > 1000 && (
            <Typography variant="body2">Showing first 1000 of {result.rows.length} rows</Typography>
          )}
          <TableContainer component={Paper} sx={{ maxHeight: 480 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {result.columns.map((c) => (
                    <TableCell key={c}>{c}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {result.rows.slice(0, 1000).map((r, i) => (
                  <TableRow key={i}>
                    {r.map((v, j) => (
                      <TableCell key={j}>{show(v)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Stack>
  );
}
