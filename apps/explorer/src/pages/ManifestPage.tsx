import {
  Alert,
  Link,
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
import { getManifest, getRuns, type Manifest } from "../api";
import { CopyButton } from "../CopyButton";
import { bytes, shortCid, shortHash } from "../format";
import { GATEWAYS, VENDOR_GATEWAY, gatewayUrl } from "../gateways";
import { useAsync } from "../useAsync";
import { VerificationMatrix } from "./VerificationMatrix";

function Cid({ cid }: { cid: string }) {
  return (
    <>
      <span title={cid}>{shortCid(cid)}</span>
      <CopyButton text={cid} />
    </>
  );
}

function GatewayLinks({ cid }: { cid: string }) {
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
      {GATEWAYS.map((g) => (
        <Link key={g} href={gatewayUrl(cid, g)} target="_blank" rel="noreferrer">
          {g}
        </Link>
      ))}
    </Stack>
  );
}

function ManifestBody({
  manifest,
  manifestCid,
}: {
  manifest: Manifest;
  manifestCid: string | null;
}) {
  const runs = useAsync(getRuns);
  const verification = runs.data?.find((r) => r.runId === manifest.runId)?.verification;
  const rows = [
    ...manifest.artifacts.map((a) => ({
      name: a.name,
      codec: a.codec,
      size: a.size,
      sha256: a.sha256,
      cid: a.cid,
    })),
    {
      name: manifest.car.name,
      codec: "car",
      size: manifest.car.size,
      sha256: manifest.car.sha256,
      cid: manifest.car.cid,
    },
  ];
  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        Run {manifest.runId} · published {manifest.publishedAt} · {manifest.county} County,{" "}
        {manifest.state} (FIPS {manifest.fips})
        {manifestCid ? (
          <>
            {" "}
            · manifest <Cid cid={manifestCid} />
          </>
        ) : null}
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {["Name", "Codec", "Size", "SHA-256", "CID", "Gateways"].map((h) => (
                <TableCell key={h}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.cid}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.codec}</TableCell>
                <TableCell>{bytes(r.size)}</TableCell>
                <TableCell title={r.sha256}>{shortHash(r.sha256)}</TableCell>
                <TableCell>
                  <Cid cid={r.cid} />
                </TableCell>
                <TableCell>
                  <GatewayLinks cid={r.cid} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="body2">
        Previous manifest:{" "}
        {manifest.previousManifestCid ? (
          <Link
            href={gatewayUrl(manifest.previousManifestCid, VENDOR_GATEWAY)}
            target="_blank"
            rel="noreferrer"
          >
            {shortCid(manifest.previousManifestCid)}
          </Link>
        ) : (
          "none (first run)"
        )}
      </Typography>
      <Typography variant="h6">Verification</Typography>
      {verification ? (
        <VerificationMatrix verification={verification} />
      ) : (
        <Alert severity="info">Verification pending.</Alert>
      )}
    </Stack>
  );
}

export function ManifestPage() {
  const res = useAsync(getManifest);
  return (
    <Stack spacing={2}>
      <Typography variant="h5">Manifest</Typography>
      {res.loading ? (
        <Typography>Loading…</Typography>
      ) : res.error ? (
        <Alert severity="error">{res.error.message}</Alert>
      ) : res.data.manifest ? (
        <ManifestBody manifest={res.data.manifest} manifestCid={res.data.manifestCid} />
      ) : (
        <Alert severity="info">
          No manifest available yet{res.data.error ? `: ${res.data.error}` : "."} Verification
          pending.
        </Alert>
      )}
    </Stack>
  );
}
