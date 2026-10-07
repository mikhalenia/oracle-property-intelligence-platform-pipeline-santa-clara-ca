import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Alert,
  Box,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { API_BASE, getHealth, getRuns, type RunRecord } from "../api";
import { num, shortCid } from "../format";
import { useAsync } from "../useAsync";

const COLORS: Record<string, "success" | "warning" | "error" | "default"> = {
  complete: "success",
  partial: "warning",
  failed: "error",
};

function SnapshotBanner() {
  const health = useAsync(getHealth);
  if (health.loading) return null;
  if (health.error) return <Alert severity="error">API unreachable: {health.error.message}</Alert>;
  const snap = health.data.snapshot;
  if (!snap) return <Alert severity="info">Snapshot not synced yet. API: {API_BASE}</Alert>;
  return (
    <Alert severity="success">
      Snapshot run <b>{snap.runId}</b> · manifest {shortCid(snap.manifestCid)} · synced{" "}
      {snap.syncedAt} · API {API_BASE}
    </Alert>
  );
}

function RunRow({ run }: { run: RunRecord }) {
  const [open, setOpen] = useState(false);
  const t = run.totals;
  return (
    <>
      <TableRow hover>
        <TableCell>
          <IconButton
            size="small"
            aria-label={open ? "collapse" : "expand"}
            onClick={() => setOpen(!open)}
          >
            <ExpandMoreIcon sx={{ transform: open ? "rotate(180deg)" : "none" }} />
          </IconButton>
        </TableCell>
        <TableCell>{run.runId}</TableCell>
        <TableCell>{run.startedAt}</TableCell>
        <TableCell>
          <Chip size="small" label={run.status} color={COLORS[run.status] ?? "default"} />
        </TableCell>
        <TableCell align="right">{num(t.properties)}</TableCell>
        <TableCell align="right">{num(t.permits)}</TableCell>
        <TableCell align="right">{num(t.roofingPermits)}</TableCell>
        <TableCell align="right">{num(t.contractors)}</TableCell>
        <TableCell align="right">{num(t.owners)}</TableCell>
        <TableCell align="right">{num(t.roofAge)}</TableCell>
        <TableCell title={run.manifestCid ?? ""}>
          {run.manifestCid ? shortCid(run.manifestCid) : "—"}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={11} sx={{ py: 0, border: open ? undefined : 0 }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ my: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {["Source", "Version", "Fetched", "+", "~", "=", "-", "State"].map((h) => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(run.sources).map(([key, s]) => (
                    <TableRow key={key}>
                      <TableCell>{key}</TableCell>
                      <TableCell>{s.sourceVersion ?? "—"}</TableCell>
                      <TableCell>{num(s.fetched)}</TableCell>
                      <TableCell>{num(s.inserted)}</TableCell>
                      <TableCell>{num(s.updated)}</TableCell>
                      <TableCell>{num(s.unchanged)}</TableCell>
                      <TableCell>{num(s.removed)}</TableCell>
                      <TableCell>
                        {s.error ? (
                          <Chip size="small" color="error" label={s.error} />
                        ) : s.skipped ? (
                          "skipped"
                        ) : (
                          "ok"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography variant="subtitle2" sx={{ mt: 1 }}>
                Limitations
              </Typography>
              {run.limitations.length === 0 ? (
                <Typography variant="body2">None recorded.</Typography>
              ) : (
                <ul>
                  {run.limitations.map((l) => (
                    <li key={l}>
                      <Typography variant="body2">{l}</Typography>
                    </li>
                  ))}
                </ul>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export function RunsPage() {
  const runs = useAsync(getRuns);
  return (
    <Stack spacing={2}>
      <Typography variant="h5">Runs</Typography>
      <SnapshotBanner />
      {runs.loading ? (
        <Typography>Loading…</Typography>
      ) : runs.error ? (
        <Alert severity="error">{runs.error.message}</Alert>
      ) : runs.data.length === 0 ? (
        <Alert severity="info">No runs yet. The snapshot is still being synced.</Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                {["Run", "Started", "Status"].map((h) => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
                {["Properties", "Permits", "Roofing", "Contractors", "Owners", "Roof age"].map(
                  (h) => (
                    <TableCell key={h} align="right">
                      {h}
                    </TableCell>
                  ),
                )}
                <TableCell>Manifest</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.data.map((r) => (
                <RunRow key={r.runId} run={r} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
