# Santa Clara property intelligence pipeline — agent guide

- Read `docs/superpowers/specs/2026-10-07-santa-clara-pipeline-design.md` before changing behavior.
- Node 22 via nvm (`nvm use`), pnpm, nx. `pnpm check` runs lint, typecheck, test, build for every project.
- Layout: `libs/domain` (pure rules, no IO), `libs/sources` (fetchers with provenance),
  `apps/pipeline` (CLI: ingest, export, publish, verify, sync, run), `apps/mcp-server`
  (Cloudflare Worker: MCP + REST over D1), `apps/explorer` (React + MUI + DuckDB-WASM).
- TDD: write the failing test first. Domain rules get unit tests; IO gets fixtures, never live calls in tests.
- Conventional commits, English only, no attribution trailers. Never push to origin unless told.
- Secrets live in `.env` (see `.env.example`). Never commit `data/`, `exports/`, `*.duckdb`, `*.car`.
- Published CIDs are immutable; never rewrite `docs/runs/*.json` of a past run.
- YAGNI: no feature flags, no abstractions for a single caller.
