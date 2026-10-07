import {
  Alert,
  Box,
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
  Tooltip,
  Typography,
} from "@mui/material";
import { lazy, Suspense, useEffect, useState } from "react";
import { getManifest } from "../api";
import { CopyButton } from "../CopyButton";
import { SQL_GATEWAYS, pickGateway } from "../gateways";
import {
  baseFor,
  loadExamples,
  resolveSql,
  runSql,
  type SqlExample,
  type SqlResult,
} from "../duckdb";

const shortCid = (c: string) => (c.length > 16 ? `${c.slice(0, 8)}…${c.slice(-6)}` : c);
const SqlEditor = lazy(() => import("./SqlEditor"));

const show = (v: unknown) =>
  v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

export function SqlPage() {
  const [base, setBase] = useState<string | null>(null);
  const [rootCid, setRootCid] = useState<string | null>(null);
  const [gateway, setGateway] = useState<string | null>(null);
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
      const gw = await pickGateway(root.cid, "leads.parquet");
      if (!live) return;
      setGateway(gw);
      setRootCid(root.cid);
      setBase(baseFor(root.cid, gw));
      setExamples(await loadExamples(root.cid, gw));
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
        Queries run in a local, in-memory DuckDB copy inside your browser. Nothing is sent to a
        server and nothing is saved: reloading the page resets everything, including any INSERT,
        UPDATE or DELETE you run.
      </Alert>
      <Typography variant="caption" color="text.secondary" component="div">
        {gateway && rootCid ? (
          <>
            Reading <code>leads.parquet</code> from{" "}
            <Tooltip
              title={`First of ${SQL_GATEWAYS.join(", ")} to answer a range probe; the manifest page verifies on independent gateways.`}
            >
              <span style={{ textDecoration: "underline dotted", cursor: "help" }}>{gateway}</span>
            </Tooltip>{" "}
            (snapshot <code>{shortCid(rootCid)}</code>
            <CopyButton text={rootCid} />)
          </>
        ) : (
          "Choosing a gateway…"
        )}
      </Typography>
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
      <Box
        onKeyDownCapture={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (!running && base && sql.trim() !== "") void run();
          }
        }}
        sx={(t) => ({
          border: `1px solid ${t.palette.divider}`,
          borderRadius: 1,
          overflow: "hidden",
          "&:focus-within": {
            borderColor: t.palette.primary.main,
            boxShadow: `0 0 0 1px ${t.palette.primary.main}`,
          },
          "& .cm-editor": { fontSize: 14, outline: "none" },
          "& .cm-scroller": { fontFamily: "ui-monospace, Menlo, Consolas, monospace" },
        })}
      >
        <Suspense fallback={<Box sx={{ height: 220, p: 1 }}>Loading editor…</Box>}>
          <SqlEditor value={sql} onChange={setSql} />
        </Suspense>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Cmd/Ctrl+Enter runs the query.
      </Typography>
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
