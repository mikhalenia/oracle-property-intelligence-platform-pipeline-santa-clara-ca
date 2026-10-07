import {
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
import { getRuns } from "../api";
import { num } from "../format";
import { useAsync } from "../useAsync";

interface CatalogEntry {
  key: string;
  owner: string;
  url: string;
  format: string;
  refresh: string;
  constraint: string;
}

const SJ = "City of San José (CKAN)";
const SJ_FMT = "CSV";
const SJ_REFRESH = "Daily 16:00 PT";
const SJ_CONSTRAINT = "Overwritten in place; refresh signal is the resource modified time";

export const CATALOG: CatalogEntry[] = [
  {
    key: "scc-parcels",
    owner: "County of Santa Clara (Socrata)",
    url: "https://data.sccgov.org/resource/ubcd-cewv",
    format: "Socrata JSON API",
    refresh: "Dataset :updated_at",
    constraint: "50k rows per page cap",
  },
  {
    key: "sj-permits-active",
    owner: SJ,
    url: "https://data.sanjoseca.gov/dataset/building-permits",
    format: SJ_FMT,
    refresh: SJ_REFRESH,
    constraint: SJ_CONSTRAINT,
  },
  {
    key: "sj-permits-under_inspection",
    owner: SJ,
    url: "https://data.sanjoseca.gov/dataset/building-permits",
    format: SJ_FMT,
    refresh: SJ_REFRESH,
    constraint: SJ_CONSTRAINT,
  },
  {
    key: "sj-permits-expired",
    owner: SJ,
    url: "https://data.sanjoseca.gov/dataset/building-permits",
    format: SJ_FMT,
    refresh: SJ_REFRESH,
    constraint: SJ_CONSTRAINT,
  },
  {
    key: "sj-permits-last_30_days",
    owner: SJ,
    url: "https://data.sanjoseca.gov/dataset/building-permits",
    format: SJ_FMT,
    refresh: SJ_REFRESH,
    constraint: SJ_CONSTRAINT,
  },
  {
    key: "cslb-c39",
    owner: "CSLB Public Data Portal",
    url: "https://www.cslb.ca.gov/onlineservices/dataportal/",
    format: "Bulk download",
    refresh: "Best effort",
    constraint: "503s and timeouts observed",
  },
];

export function SourcesPage() {
  const runs = useAsync(getRuns);
  const latest = runs.data?.[0];
  return (
    <Stack spacing={2}>
      <Typography variant="h5">Sources</Typography>
      <Typography variant="body2" color="text.secondary">
        {latest ? `Latest run ${latest.runId}.` : "No run data yet; showing the catalog only."}
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {[
                "Key",
                "Owner",
                "URL",
                "Format",
                "Refresh signal",
                "Constraint",
                "Version",
                "Fetched",
                "Delta (+/~/-)",
              ].map((h) => (
                <TableCell key={h}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {CATALOG.map((c) => {
              const s = latest?.sources[c.key];
              return (
                <TableRow key={c.key}>
                  <TableCell>{c.key}</TableCell>
                  <TableCell>{c.owner}</TableCell>
                  <TableCell>
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.url}
                    </a>
                  </TableCell>
                  <TableCell>{c.format}</TableCell>
                  <TableCell>{c.refresh}</TableCell>
                  <TableCell>{c.constraint}</TableCell>
                  <TableCell>{s ? (s.sourceVersion ?? "—") : "—"}</TableCell>
                  <TableCell>{s ? num(s.fetched) : "—"}</TableCell>
                  <TableCell>
                    {s
                      ? `${num(s.inserted)} / ${num(s.updated)} / ${num(s.removed)}${s.skipped ? " (skipped)" : ""}`
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
