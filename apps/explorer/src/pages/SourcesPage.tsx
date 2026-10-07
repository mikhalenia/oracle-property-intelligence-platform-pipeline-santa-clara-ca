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
    url: "https://data.sccgov.org/resource/ubcd-cewv.json",
    format: "Socrata JSON API",
    refresh: "Dataset :updated_at",
    constraint: "50k rows per page cap",
  },
  {
    key: "sj-permits-active",
    owner: SJ,
    url: "https://data.sanjoseca.gov/dataset/fd9ceb0c-75e0-402e-9fe3-3f6e04f2c23f/resource/761b7ae8-3be1-4ad6-923d-c7af6404a904/download/buildingpermitsactive.csv",
    format: SJ_FMT,
    refresh: SJ_REFRESH,
    constraint: SJ_CONSTRAINT,
  },
  {
    key: "sj-permits-under_inspection",
    owner: SJ,
    url: "https://data.sanjoseca.gov/dataset/ca355e55-c651-4e00-9bde-2c014f229486/resource/89ccdad9-7309-4826-a5f3-2fcf1fcb20fa/download/buildingpermitsunderinspection.csv",
    format: SJ_FMT,
    refresh: SJ_REFRESH,
    constraint: SJ_CONSTRAINT,
  },
  {
    key: "sj-permits-expired",
    owner: SJ,
    url: "https://data.sanjoseca.gov/dataset/3b40d486-bd19-44c5-b854-5f0638c2afc3/resource/df4b8461-0c7a-4d16-b85d-ff7f71c5fed5/download/buildingpermitsexpired.csv",
    format: SJ_FMT,
    refresh: SJ_REFRESH,
    constraint: SJ_CONSTRAINT,
  },
  {
    key: "sj-permits-last_30_days",
    owner: SJ,
    url: "https://data.sanjoseca.gov/dataset/2723cdec-a639-4b63-bded-175338c45473/resource/045b3678-e923-4002-b696-300955bc6d06/download/buildingpermits30.csv",
    format: SJ_FMT,
    refresh: SJ_REFRESH,
    constraint: SJ_CONSTRAINT,
  },
  {
    key: "cslb-c39",
    owner: "CSLB Public Data Portal",
    url: "https://www2.cslb.ca.gov/onlineservices/dataportal/ListByCounty",
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
