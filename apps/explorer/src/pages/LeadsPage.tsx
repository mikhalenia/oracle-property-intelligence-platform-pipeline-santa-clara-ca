import {
  Alert,
  Button,
  Link,
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
import { useState } from "react";
import { getAgedRoofs, getOpenPermits, type Lead, type LeadsResponse } from "../api";
import { shortCid } from "../format";

/** Downtown San José (City Hall area). */
const DOWNTOWN = { lat: 37.3382, lon: -121.8863 };
const STATES = [
  ["any", "Any (open + stalled)"],
  ["open", "Open"],
  ["expired_unfinaled", "Stalled (expired, no final, no Complete approval)"],
] as const;
type PermitState = (typeof STATES)[number][0];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const dash = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : v);
const BASIS: Record<string, string> = {
  final_date: "final inspection",
  approval_complete_issue_date: "issue date (approvals Complete)",
};

function LeadsTable({ title, res }: { title: string; res: LeadsResponse }) {
  const cid = res.snapshot.manifestCid;
  const row = (l: Lead) => (
    <TableRow key={`${l.apn}-${l.permitNumber}`}>
      <TableCell>{dash(l.situsAddress)}</TableCell>
      <TableCell>{dash(l.apn)}</TableCell>
      <TableCell>
        {l.roofAgeYears === null
          ? "—"
          : `${l.roofAgeYears} y · ${BASIS[l.roofAgeAnchor ?? ""] ?? dash(l.roofAgeAnchor)} · ${dash(l.roofAgeConfidence)}`}
      </TableCell>
      <TableCell>
        {l.permitNumber
          ? `${l.permitNumber} · ${dash(l.permitState)} · ${l.daysOpen === null ? "—" : `${l.daysOpen} d`}`
          : "—"}
      </TableCell>
      <TableCell>{dash(l.contractorCompany)}</TableCell>
      <TableCell>{dash(l.ownerName)}</TableCell>
      <TableCell>{l.distanceMiles.toFixed(2)} mi</TableCell>
      <TableCell>
        <Stack direction="row" spacing={1}>
          {l.provenance.permitSourceUrl && (
            <Link href={l.provenance.permitSourceUrl} target="_blank" rel="noreferrer">
              permit source
            </Link>
          )}
          {l.provenance.propertySourceUrl && (
            <Link href={l.provenance.propertySourceUrl} target="_blank" rel="noreferrer">
              parcel source
            </Link>
          )}
          {cid && <span title={cid}>manifest {shortCid(cid)}</span>}
        </Stack>
      </TableCell>
    </TableRow>
  );
  return (
    <Stack spacing={1}>
      <Typography variant="h6">
        {title} ({res.items.length})
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {[
                "Address",
                "APN",
                "Roof age · basis · confidence",
                "Permit · state · days open",
                "Contractor",
                "Owner",
                "Distance",
                "Provenance",
              ].map((h) => (
                <TableCell key={h}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>{res.items.map(row)}</TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}

export function LeadsPage() {
  const [lat, setLat] = useState(DOWNTOWN.lat);
  const [lon, setLon] = useState(DOWNTOWN.lon);
  const [radiusMiles, setRadius] = useState(5);
  const [minRoofAgeYears, setMinAge] = useState(15);
  const [state, setState] = useState<PermitState>("any");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aged, setAged] = useState<LeadsResponse | null>(null);
  const [open, setOpen] = useState<LeadsResponse | null>(null);

  const search = async () => {
    setLoading(true);
    setError(null);
    try {
      const center = { lat, lon, radiusMiles };
      const [a, o] = await Promise.all([
        getAgedRoofs({ ...center, minRoofAgeYears }),
        getOpenPermits({ ...center, state }),
      ]);
      setAged(a);
      setOpen(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const numberField = (
    label: string,
    value: number,
    set: (n: number) => void,
    min?: number,
    max?: number,
    step = 0.0001,
  ) => (
    <TextField
      label={label}
      type="number"
      size="small"
      value={value}
      slotProps={{ htmlInput: { min, max, step } }}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n))
          set(min !== undefined && max !== undefined ? clamp(n, min, max) : n);
      }}
    />
  );

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Leads</Typography>
      <Typography variant="body2">
        Live answers from the REST API over the D1 snapshot: properties with old roofs and roofing
        permits without a final inspection, longest open first.
      </Typography>
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        {numberField("Latitude", lat, setLat)}
        {numberField("Longitude", lon, setLon)}
        <Button
          variant="outlined"
          onClick={() => {
            setLat(DOWNTOWN.lat);
            setLon(DOWNTOWN.lon);
          }}
        >
          Downtown San José
        </Button>
        {numberField("Radius (miles)", radiusMiles, setRadius, 0.5, 25, 0.5)}
        {numberField("Min roof age (years)", minRoofAgeYears, setMinAge, 5, 40, 1)}
        <TextField
          select
          label="Permit state"
          size="small"
          value={state}
          onChange={(e) => setState(e.target.value as PermitState)}
          sx={{ minWidth: 220 }}
        >
          {STATES.map(([v, label]) => (
            <MenuItem key={v} value={v}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" onClick={search} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {aged && <LeadsTable title={`Roofs at least ${minRoofAgeYears} years old`} res={aged} />}
      {open && <LeadsTable title="Roofing permits without a final inspection" res={open} />}
    </Stack>
  );
}
