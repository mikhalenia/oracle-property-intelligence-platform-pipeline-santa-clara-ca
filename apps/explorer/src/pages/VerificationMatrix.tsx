import { Chip, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import type { Verification } from "../api";

export function VerificationMatrix({ verification: v }: { verification: Verification }) {
  return (
    <>
      <Typography variant="body2">
        Verified {v.verifiedAt} · {v.ok ? "OK" : "FAILED"} · requires {v.minIndependent} independent
        gateway(s)
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Artifact</TableCell>
            {v.gateways.map((g) => (
              <TableCell key={g}>{g}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {v.artifacts.map((a) => (
            <TableRow key={a.cid}>
              <TableCell>{a.name}</TableCell>
              {v.gateways.map((g) => {
                const r = a.results.find((x) => x.gateway === g);
                const ok = r !== undefined && r.sha256Match;
                return (
                  <TableCell key={g}>
                    {r ? (
                      <Chip
                        size="small"
                        color={ok ? "success" : "error"}
                        label={`${r.status} · ${r.ms} ms`}
                        title={r.note}
                      />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
