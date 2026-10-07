import { AppBar, Box, Button, Container, CssBaseline, Toolbar, Typography } from "@mui/material";
import { Link, Route, Routes } from "react-router-dom";
import { LeadsPage } from "./pages/LeadsPage";
import { ManifestPage } from "./pages/ManifestPage";
import { RunsPage } from "./pages/RunsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { SqlPage } from "./pages/SqlPage";

const NAV = [
  ["Runs", "/"],
  ["Leads", "/leads"],
  ["Sources", "/sources"],
  ["Manifest", "/manifest"],
  ["SQL", "/sql"],
] as const;

export default function App() {
  return (
    <>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar sx={{ gap: 1, flexWrap: "wrap" }}>
          <Typography variant="h6" sx={{ mr: 2 }}>
            Santa Clara Property Intelligence
          </Typography>
          {NAV.map(([label, to]) => (
            <Button key={to} color="inherit" component={Link} to={to}>
              {label}
            </Button>
          ))}
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl">
        <Box sx={{ py: 3 }}>
          <Routes>
            <Route path="/" element={<RunsPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/manifest" element={<ManifestPage />} />
            <Route path="/sql" element={<SqlPage />} />
          </Routes>
        </Box>
      </Container>
    </>
  );
}
