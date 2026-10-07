# Santa Clara Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incremental ingestion of Santa Clara County parcels and San José permits into DuckDB, published as immutable CIDv1 snapshots on IPFS, served through a hosted MCP/REST Worker and an Explorer UI with a DuckDB-WASM query panel.

**Architecture:** Pure domain rules (`libs/domain`) and provenance-tracking fetchers (`libs/sources`) feed a Node CLI (`apps/pipeline`) that upserts into a local DuckDB file, exports Parquet, packs a CAR, uploads to Filebase, verifies public gateways, and syncs the snapshot into Cloudflare D1. A Hono Worker (`apps/mcp-server`) serves MCP tools and REST over D1; a React + MUI Explorer (`apps/explorer`) renders runs, manifest and a DuckDB-WASM SQL panel over the published Parquet.

**Tech Stack:** TypeScript 5, Node 22 (nvm), pnpm, nx 23, Vitest 5, Zod 4, `@duckdb/node-api` 1.5, `csv-parse` 7, `ipfs-unixfs-importer` 17 + `@ipld/car` 5 + `multiformats` 14, `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`, Hono 4 + `@hono/mcp`, `@modelcontextprotocol/sdk` 1.32, wrangler 4, `@cloudflare/vitest-pool-workers`, React 19 + MUI 9 + Vite, `@duckdb/duckdb-wasm`.

**Spec:** `docs/superpowers/specs/2026-10-07-santa-clara-pipeline-design.md`

## Global Constraints

- Node `>=22.18` (`.nvmrc` = `22`), pnpm, nx. TypeScript `strict: true`. No Python.
- All code, docs, commit messages in English. Conventional commits. No `Co-Authored-By` lines.
- Never push to `origin`; commit locally only.
- Secrets only from `.env` at the repository root (`FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`) or process env. Never commit `.env`, `data/`, `exports/`, `*.duckdb`, `*.car`.
- County FIPS `06085`. Roof-age default threshold 15 years. Roofing regex `/\b(re-?roof|roof(ing)?|shingle)\b/i`.
- CIDs are CIDv1 base32. Previously published CIDs are never mutated.
- Every stored record has `source_key, source_url, source_version, fetched_at, page_sha256, record_hash`.

## Review Focus

1. A permit number present in two CSVs (e.g. `active` and `under_inspection`) must collapse to one row with precedence `under_inspection > active > expired` — pinned in Task 4.
2. An APN like `277-15-017`, `27715017`, ` 27715017 ` or `2.7715017E7` must normalize to `27715017` or be rejected (`null`), never silently mis-keyed — pinned in Task 2.
3. `ISSUEDATE` in `M/D/YYYY h:mm:ss AM` format and empty `FINALDATE` must yield `permit_state = open` and `days_open` relative to the run's `as_of`, not to `Date.now()` — pinned in Task 2 and Task 4.
4. Re-running `ingest` with identical sources must produce zero inserted/updated/removed and a new `runs` row marked unchanged — pinned in Task 4.
5. `verify` must fail (exit 1) when only one non-vendor gateway serves an object, and must not count the pinning vendor's gateway — pinned in Task 7.

---

### Task 1: Workspace scaffold, tooling, CLAUDE.md, CI

**Files:**
- Create: `.nvmrc`, `package.json`, `pnpm-workspace.yaml`, `nx.json`, `tsconfig.base.json`, `.gitignore`, `.prettierrc`, `eslint.config.mjs`, `vitest.workspace.ts`, `CLAUDE.md`, `.github/workflows/ci.yml`, `.env.example`
- Modify: `README.md` (append "Candidate implementation" section pointer; keep assignment text intact)

**Interfaces:**
- Produces: `pnpm nx run-many -t lint typecheck test build` as the single CI gate; path aliases `@scc/domain` → `libs/domain/src/index.ts`, `@scc/sources` → `libs/sources/src/index.ts`.

- [ ] **Step 1: Node and package manager**

```bash
cd <path-to-this-repo>
echo 22 > .nvmrc
corepack enable && corepack prepare pnpm@latest --activate
pnpm init
```

Edit `package.json` to:

```json
{
  "name": "@scc/workspace",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=22.18" },
  "scripts": {
    "lint": "nx run-many -t lint",
    "typecheck": "nx run-many -t typecheck",
    "test": "nx run-many -t test",
    "build": "nx run-many -t build",
    "check": "nx run-many -t lint typecheck test build"
  }
}
```

(Replace the `packageManager` version with whatever `pnpm -v` prints.)

- [ ] **Step 2: nx + TypeScript + vitest + eslint + prettier**

```bash
pnpm add -D nx@latest @nx/js @nx/vite @nx/react @nx/eslint typescript vitest @vitest/coverage-v8 eslint @eslint/js typescript-eslint prettier eslint-config-prettier
pnpm nx init --no-interactive
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "libs/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@scc/domain": ["libs/domain/src/index.ts"],
      "@scc/sources": ["libs/sources/src/index.ts"]
    }
  }
}
```

Create `nx.json`:

```json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "namedInputs": { "default": ["{projectRoot}/**/*", "sharedGlobals"], "sharedGlobals": [] },
  "targetDefaults": {
    "build": { "dependsOn": ["^build"], "cache": true },
    "test": { "cache": true },
    "lint": { "cache": true },
    "typecheck": { "cache": true }
  },
  "plugins": [
    { "plugin": "@nx/vite/plugin", "options": { "testTargetName": "test", "buildTargetName": "build", "serveTargetName": "serve" } },
    { "plugin": "@nx/eslint/plugin", "options": { "targetName": "lint" } }
  ]
}
```

Create `eslint.config.mjs`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.wrangler/**", "data/**", "exports/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  { rules: { "@typescript-eslint/no-explicit-any": "error" } },
);
```

Create `.prettierrc`: `{ "printWidth": 100, "singleQuote": false, "trailingComma": "all" }`.

Create `.gitignore`:

```
node_modules/
dist/
.nx/
.wrangler/
.env
data/
exports/
*.duckdb
*.duckdb.wal
*.car
coverage/
```

Create `.env.example`:

```
FILEBASE_ACCESS_KEY=
FILEBASE_SECRET_KEY=
FILEBASE_BUCKET=
CLOUDFLARE_ACCOUNT_ID=
```

- [ ] **Step 3: Library and app skeletons**

```bash
pnpm nx g @nx/js:lib libs/domain --bundler=none --unitTestRunner=vitest --linter=eslint --no-interactive
pnpm nx g @nx/js:lib libs/sources --bundler=none --unitTestRunner=vitest --linter=eslint --no-interactive
pnpm nx g @nx/js:lib apps/pipeline --bundler=none --unitTestRunner=vitest --linter=eslint --no-interactive
```

Each generated project gets a `typecheck` target; add to each `project.json`:

```json
"typecheck": { "command": "tsc -p {projectRoot}/tsconfig.lib.json --noEmit" }
```

Ensure each `tsconfig.lib.json` extends `../../tsconfig.base.json` and that each `vite.config.ts` (generated for vitest) has `test: { environment: "node", include: ["src/**/*.test.ts"] }`.

- [ ] **Step 4: Smoke test the toolchain**

Create `libs/domain/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
describe("toolchain", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```

Run: `pnpm nx run-many -t lint typecheck test`
Expected: all three succeed (test shows 1 passed).

- [ ] **Step 5: CLAUDE.md and CI**

Create `CLAUDE.md`:

```markdown
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
```

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main, "feat/**"]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm nx run-many -t lint typecheck test build --parallel=3
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold nx workspace with domain, sources and pipeline projects"
```

---

### Task 2: Domain rules (`libs/domain`)

**Files:**
- Create: `libs/domain/src/apn.ts`, `libs/domain/src/roofing.ts`, `libs/domain/src/dates.ts`, `libs/domain/src/permit-state.ts`, `libs/domain/src/contractor.ts`, `libs/domain/src/roof-age.ts`, `libs/domain/src/geo.ts`, `libs/domain/src/index.ts`
- Test: `libs/domain/src/*.test.ts` (one per module)
- Delete: `libs/domain/src/index.test.ts` (toolchain smoke)

**Interfaces:**
- Produces:
  - `normalizeApn(raw: string | null | undefined): string | null`
  - `isRoofingWork(parts: { workDescription?: string; subtype?: string; folderName?: string }): boolean`
  - `parseUsDate(raw: string | null | undefined): string | null` (ISO `YYYY-MM-DD`)
  - `type PermitState = "open" | "expired_unfinaled" | "finaled"`
  - `derivePermitState(input: { status: "active" | "under_inspection" | "expired"; finalDate: string | null }): PermitState`
  - `daysOpen(input: { state: PermitState; issueDate: string | null; finalDate: string | null; asOf: string }): number | null`
  - `splitContractor(raw: string): { companyName: string | null; contactName: string | null }`
  - `normalizeCompanyName(name: string): string`
  - `contractorId(companyName: string): string` (sha256 hex of normalized name, first 16 chars)
  - `type RoofAge = { roofDate: string; roofAgeYears: number; anchor: "final_date" | "approval_complete_issue_date"; confidence: "high" | "medium" }`
  - `deriveRoofAge(input: { isRoofing: boolean; approvals: string | null; issueDate: string | null; finalDate: string | null; asOf: string }): RoofAge | null`
  - `haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number`
  - `boundingBox(center: { lat: number; lon: number }, radiusMiles: number): { minLat: number; maxLat: number; minLon: number; maxLon: number }`
  - `bboxCenter(coordinates: number[][][][] | number[][][]): { lat: number; lon: number } | null` (GeoJSON MultiPolygon/Polygon)

- [ ] **Step 1: Write failing tests for APN, roofing, dates**

`libs/domain/src/apn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeApn } from "./apn";

describe("normalizeApn", () => {
  it("accepts 8 digits", () => expect(normalizeApn("27715017")).toBe("27715017"));
  it("accepts dashed form", () => expect(normalizeApn("277-15-017")).toBe("27715017"));
  it("trims whitespace", () => expect(normalizeApn(" 27715017 ")).toBe("27715017"));
  it("rejects scientific notation", () => expect(normalizeApn("2.7715017E7")).toBeNull());
  it("rejects short, empty, null", () => {
    expect(normalizeApn("1234567")).toBeNull();
    expect(normalizeApn("")).toBeNull();
    expect(normalizeApn(null)).toBeNull();
  });
  it("rejects 9+ digits", () => expect(normalizeApn("277150170")).toBeNull());
});
```

`libs/domain/src/roofing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isRoofingWork } from "./roofing";

describe("isRoofingWork", () => {
  it("matches ReRoof work description", () =>
    expect(isRoofingWork({ workDescription: "ReRoof" })).toBe(true));
  it("matches Re-Roof and roofing in subtype/folder", () => {
    expect(isRoofingWork({ subtype: "Re-Roof Residential" })).toBe(true);
    expect(isRoofingWork({ folderName: "ROOFING REPAIR" })).toBe(true);
    expect(isRoofingWork({ folderName: "shingle replacement" })).toBe(true);
  });
  it("does not match unrelated or substring-only words", () => {
    expect(isRoofingWork({ workDescription: "Tenant Improvement" })).toBe(false);
    expect(isRoofingWork({ workDescription: "Fireproofing" })).toBe(false);
    expect(isRoofingWork({})).toBe(false);
  });
});
```

`libs/domain/src/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseUsDate } from "./dates";

describe("parseUsDate", () => {
  it("parses M/D/YYYY with time", () => expect(parseUsDate("8/14/2026 12:00:00 AM")).toBe("2026-08-14"));
  it("parses MM/DD/YYYY", () => expect(parseUsDate("03/11/1986")).toBe("1986-03-11"));
  it("returns null for empty or garbage", () => {
    expect(parseUsDate("")).toBeNull();
    expect(parseUsDate(null)).toBeNull();
    expect(parseUsDate("not a date")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx test domain`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`libs/domain/src/apn.ts`:

```ts
export function normalizeApn(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || /[eE]/.test(trimmed)) return null;
  const digits = trimmed.replace(/-/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
}
```

`libs/domain/src/roofing.ts`:

```ts
const ROOFING = /\b(re-?roof|roof(ing)?|shingle)\b/i;

export function isRoofingWork(parts: {
  workDescription?: string;
  subtype?: string;
  folderName?: string;
}): boolean {
  return [parts.workDescription, parts.subtype, parts.folderName].some(
    (p) => typeof p === "string" && ROOFING.test(p),
  );
}
```

`libs/domain/src/dates.ts`:

```ts
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/;

export function parseUsDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = US_DATE.exec(raw.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.floor(ms / 86_400_000);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx test domain`
Expected: PASS (all three files).

- [ ] **Step 5: Write failing tests for permit state, contractor, roof age, geo**

`libs/domain/src/permit-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { daysOpen, derivePermitState } from "./permit-state";

describe("derivePermitState", () => {
  it("active without final date is open", () =>
    expect(derivePermitState({ status: "active", finalDate: null })).toBe("open"));
  it("under_inspection without final date is open", () =>
    expect(derivePermitState({ status: "under_inspection", finalDate: null })).toBe("open"));
  it("any status with final date is finaled", () =>
    expect(derivePermitState({ status: "expired", finalDate: "2020-01-01" })).toBe("finaled"));
  it("expired without final date is expired_unfinaled", () =>
    expect(derivePermitState({ status: "expired", finalDate: null })).toBe("expired_unfinaled"));
});

describe("daysOpen", () => {
  const asOf = "2026-10-08";
  it("open: issue to as-of", () =>
    expect(daysOpen({ state: "open", issueDate: "2026-08-14", finalDate: null, asOf })).toBe(55));
  it("finaled: issue to final", () =>
    expect(daysOpen({ state: "finaled", issueDate: "2020-01-01", finalDate: "2020-03-01", asOf })).toBe(60));
  it("expired_unfinaled: issue to as-of", () =>
    expect(daysOpen({ state: "expired_unfinaled", issueDate: "2016-10-08", finalDate: null, asOf })).toBe(3652));
  it("null without issue date", () =>
    expect(daysOpen({ state: "open", issueDate: null, finalDate: null, asOf })).toBeNull());
});
```

`libs/domain/src/contractor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contractorId, normalizeCompanyName, splitContractor } from "./contractor";

describe("splitContractor", () => {
  it("splits company and contact on double space", () =>
    expect(splitContractor("PEACH ROOFING SOLUTIONS INC  Jason Nesbitt")).toEqual({
      companyName: "PEACH ROOFING SOLUTIONS INC",
      contactName: "Jason Nesbitt",
    }));
  it("handles company only with trailing spaces", () =>
    expect(splitContractor("BARNUM & CELILLO ELECTRIC INC   ")).toEqual({
      companyName: "BARNUM & CELILLO ELECTRIC INC",
      contactName: null,
    }));
  it("empty is null/null", () =>
    expect(splitContractor("   ")).toEqual({ companyName: null, contactName: null }));
});

describe("normalizeCompanyName", () => {
  it("upper-cases, strips punctuation and legal suffixes", () => {
    expect(normalizeCompanyName("Peach Roofing Solutions, Inc.")).toBe("PEACH ROOFING SOLUTIONS");
    expect(normalizeCompanyName("ECONOMY ROOFING INC")).toBe("ECONOMY ROOFING");
    expect(normalizeCompanyName("A S E Builders LLC")).toBe("A S E BUILDERS");
  });
});

describe("contractorId", () => {
  it("is stable and 16 hex chars", () => {
    const id = contractorId("Peach Roofing Solutions, Inc.");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(contractorId("PEACH ROOFING SOLUTIONS INC")).toBe(id);
  });
});
```

`libs/domain/src/roof-age.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveRoofAge } from "./roof-age";

const asOf = "2026-10-08";

describe("deriveRoofAge", () => {
  it("uses final date with high confidence", () =>
    expect(
      deriveRoofAge({ isRoofing: true, approvals: "B-Complete", issueDate: "2010-05-01", finalDate: "2010-06-15", asOf }),
    ).toEqual({ roofDate: "2010-06-15", roofAgeYears: 16, anchor: "final_date", confidence: "high" }));
  it("falls back to issue date when approvals say Complete", () =>
    expect(
      deriveRoofAge({ isRoofing: true, approvals: "B-4. Complete, E-4. Complete", issueDate: "2016-10-09", finalDate: null, asOf }),
    ).toEqual({ roofDate: "2016-10-09", roofAgeYears: 9, anchor: "approval_complete_issue_date", confidence: "medium" }));
  it("returns null when not roofing, not complete, or no dates", () => {
    expect(deriveRoofAge({ isRoofing: false, approvals: "B-Complete", issueDate: "2010-01-01", finalDate: "2010-02-01", asOf })).toBeNull();
    expect(deriveRoofAge({ isRoofing: true, approvals: "", issueDate: "2010-01-01", finalDate: null, asOf })).toBeNull();
    expect(deriveRoofAge({ isRoofing: true, approvals: "B-Complete", issueDate: null, finalDate: null, asOf })).toBeNull();
  });
  it("floors partial years", () =>
    expect(deriveRoofAge({ isRoofing: true, approvals: "", issueDate: null, finalDate: "2011-10-09", asOf })?.roofAgeYears).toBe(14));
});
```

`libs/domain/src/geo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bboxCenter, boundingBox, haversineMiles } from "./geo";

describe("geo", () => {
  const sanJose = { lat: 37.3382, lon: -121.8863 };
  const paloAlto = { lat: 37.4419, lon: -122.143 };
  it("haversine San Jose to Palo Alto is about 16 miles", () =>
    expect(haversineMiles(sanJose, paloAlto)).toBeCloseTo(16.0, 0));
  it("bounding box contains the circle", () => {
    const b = boundingBox(sanJose, 5);
    expect(b.minLat).toBeLessThan(sanJose.lat);
    expect(b.maxLat).toBeGreaterThan(sanJose.lat);
    expect(b.maxLat - b.minLat).toBeCloseTo(0.1449, 3);
  });
  it("bboxCenter of a MultiPolygon", () =>
    expect(
      bboxCenter([[[[-121.92, 37.32], [-121.92, 37.3218], [-121.9227, 37.3218], [-121.9227, 37.32], [-121.92, 37.32]]]]),
    ).toEqual({ lat: 37.3209, lon: -121.92135 }));
  it("bboxCenter of empty is null", () => expect(bboxCenter([])).toBeNull());
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm nx test domain`
Expected: FAIL for the four new files.

- [ ] **Step 7: Implement**

`libs/domain/src/permit-state.ts`:

```ts
import { daysBetween } from "./dates";

export type PermitStatus = "active" | "under_inspection" | "expired";
export type PermitState = "open" | "expired_unfinaled" | "finaled";

export function derivePermitState(input: { status: PermitStatus; finalDate: string | null }): PermitState {
  if (input.finalDate) return "finaled";
  return input.status === "expired" ? "expired_unfinaled" : "open";
}

export function daysOpen(input: {
  state: PermitState;
  issueDate: string | null;
  finalDate: string | null;
  asOf: string;
}): number | null {
  if (!input.issueDate) return null;
  if (input.state === "finaled") return input.finalDate ? daysBetween(input.issueDate, input.finalDate) : null;
  return daysBetween(input.issueDate, input.asOf);
}
```

`libs/domain/src/contractor.ts`:

```ts
import { createHash } from "node:crypto";

const LEGAL_SUFFIX = /\b(INC|INCORPORATED|LLC|L L C|CORP|CORPORATION|CO|COMPANY|LTD|LP)\b\.?/g;

export function splitContractor(raw: string): { companyName: string | null; contactName: string | null } {
  const text = raw.replace(/\s+$/, "");
  if (text.trim() === "") return { companyName: null, contactName: null };
  const idx = text.indexOf("  ");
  if (idx === -1) return { companyName: text.trim(), contactName: null };
  const company = text.slice(0, idx).trim();
  const contact = text.slice(idx).trim();
  return { companyName: company || null, contactName: contact || null };
}

export function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,'"()&/-]/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contractorId(companyName: string): string {
  return createHash("sha256").update(normalizeCompanyName(companyName)).digest("hex").slice(0, 16);
}
```

Note: the `&` is stripped for matching only; `company_name` keeps the raw spelling.

`libs/domain/src/roof-age.ts`:

```ts
import { daysBetween } from "./dates";

export type RoofAge = {
  roofDate: string;
  roofAgeYears: number;
  anchor: "final_date" | "approval_complete_issue_date";
  confidence: "high" | "medium";
};

export function deriveRoofAge(input: {
  isRoofing: boolean;
  approvals: string | null;
  issueDate: string | null;
  finalDate: string | null;
  asOf: string;
}): RoofAge | null {
  if (!input.isRoofing) return null;
  let roofDate: string | null = null;
  let anchor: RoofAge["anchor"] = "final_date";
  if (input.finalDate) {
    roofDate = input.finalDate;
  } else if (input.issueDate && /\bComplete\b/i.test(input.approvals ?? "")) {
    roofDate = input.issueDate;
    anchor = "approval_complete_issue_date";
  }
  if (!roofDate) return null;
  const years = Math.floor(daysBetween(roofDate, input.asOf) / 365.25);
  return { roofDate, roofAgeYears: years, anchor, confidence: anchor === "final_date" ? "high" : "medium" };
}
```

`libs/domain/src/geo.ts`:

```ts
const EARTH_RADIUS_MILES = 3958.7613;

export function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

export function boundingBox(center: { lat: number; lon: number }, radiusMiles: number) {
  const dLat = radiusMiles / 69.0;
  const dLon = radiusMiles / (69.0 * Math.cos((center.lat * Math.PI) / 180));
  return { minLat: center.lat - dLat, maxLat: center.lat + dLat, minLon: center.lon - dLon, maxLon: center.lon + dLon };
}

export function bboxCenter(coordinates: unknown): { lat: number; lon: number } | null {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node.length === 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      const [lon, lat] = node;
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      return;
    }
    node.forEach(walk);
  };
  walk(coordinates);
  if (!Number.isFinite(minLat)) return null;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { lat: round((minLat + maxLat) / 2), lon: round((minLon + maxLon) / 2) };
}
```

`libs/domain/src/index.ts` re-exports everything from the seven modules.

- [ ] **Step 8: Run tests, lint, typecheck**

Run: `pnpm nx run-many -t test lint typecheck -p domain`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add libs/domain
git commit -m "feat(domain): apn, roofing, permit state, contractor, roof age and geo rules"
```

---

### Task 3: Source fetchers with provenance (`libs/sources`)

**Files:**
- Create: `libs/sources/src/hash.ts`, `libs/sources/src/http.ts`, `libs/sources/src/provenance.ts`, `libs/sources/src/socrata-parcels.ts`, `libs/sources/src/ckan-permits.ts`, `libs/sources/src/index.ts`
- Create fixtures: `libs/sources/fixtures/parcels-page.json` (3 records copied from the live API shape), `libs/sources/fixtures/permits-active.csv` (5 rows incl. one roofing, one with empty APN, one duplicate FOLDERNUMBER with inspection), `libs/sources/fixtures/permits-inspection.csv` (3 rows), `libs/sources/fixtures/ckan-package.json` (trimmed `package_show` response)
- Test: `libs/sources/src/*.test.ts`

**Interfaces:**
- Consumes: `@scc/domain` (`normalizeApn`, `bboxCenter`, `parseUsDate`, `isRoofingWork`, `splitContractor`).
- Produces:
  - `sha256Hex(data: Uint8Array | string): string`
  - `type Fetcher = (url: string, init?: RequestInit) => Promise<Response>`; `fetchWithRetry(fetcher: Fetcher, url: string, init?: RequestInit, opts?: { retries?: number; baseDelayMs?: number }): Promise<Response>`
  - `type Provenance = { sourceKey: string; sourceUrl: string; sourceVersion: string; fetchedAt: string; pageSha256: string }`
  - `type ParcelRow = { apn: string; situsAddress: string | null; situsCity: string | null; situsZip: string | null; jurisdiction: string | null; taxRateArea: string | null; lat: number | null; lon: number | null } & Provenance & { recordHash: string }`
  - `fetchParcelVersion(fetcher): Promise<string>` (max `:updated_at`)
  - `fetchParcelPages(fetcher, opts: { pageSize?: number; maxPages?: number; outDir: string; sourceVersion: string; fetchedAt: string }): AsyncGenerator<{ pageIndex: number; rows: ParcelRow[]; skippedNoApn: number }>`
  - `type PermitStatusKey = "active" | "under_inspection" | "expired" | "last_30_days"`
  - `type PermitRow = { permitNumber: string; apn: string | null; status: "active" | "under_inspection" | "expired"; isRoofing: boolean; workDescription: string | null; subtype: string | null; folderName: string | null; approvals: string | null; issueDate: string | null; finalDate: string | null; valuation: number | null; address: string | null; applicant: string | null; ownerNameRaw: string | null; contractorRaw: string | null; contractorCompany: string | null; contractorContact: string | null; folderRsn: string | null } & Provenance & { recordHash: string }`
  - `CKAN_PERMIT_RESOURCES: Record<PermitStatusKey, { packageId: string; downloadUrl: string }>`
  - `fetchCkanResourceVersion(fetcher, packageId): Promise<string>` (`last_modified` of the CSV resource)
  - `downloadPermitsCsv(fetcher, key: PermitStatusKey, outDir: string): Promise<{ path: string; sha256: string; bytes: number }>`
  - `parsePermitsCsv(path: string, meta: { key: PermitStatusKey; sourceUrl: string; sourceVersion: string; fetchedAt: string; pageSha256: string }): AsyncGenerator<PermitRow>`

- [ ] **Step 1: Failing tests for hash, retry, provenance**

`libs/sources/src/http.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./http";
import { sha256Hex } from "./hash";

describe("sha256Hex", () => {
  it("hashes strings and bytes identically", () =>
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
});

describe("fetchWithRetry", () => {
  it("retries on 503 then succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await fetchWithRetry(fetcher, "https://x", undefined, { retries: 2, baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("throws after exhausting retries", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    await expect(fetchWithRetry(fetcher, "https://x", undefined, { retries: 1, baseDelayMs: 1 })).rejects.toThrow(/503/);
  });
  it("does not retry 404", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("no", { status: 404 }));
    await expect(fetchWithRetry(fetcher, "https://x", undefined, { retries: 3, baseDelayMs: 1 })).rejects.toThrow(/404/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm nx test sources` → FAIL.

- [ ] **Step 3: Implement hash, http, provenance**

`libs/sources/src/hash.ts`:

```ts
import { createHash } from "node:crypto";
export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
```

`libs/sources/src/http.ts`:

```ts
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export async function fetchWithRetry(
  fetcher: Fetcher,
  url: string,
  init?: RequestInit,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetcher(url, { ...init, headers: { "user-agent": "scc-pipeline/0.1", ...(init?.headers ?? {}) } });
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status} for ${url}`);
      if (!RETRYABLE.has(res.status)) throw lastError;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && /^HTTP \d{3}/.test(err.message) && !RETRYABLE.has(Number(err.message.slice(5, 8)))) throw err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, base * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
```

`libs/sources/src/provenance.ts`:

```ts
import { sha256Hex } from "./hash";

export type Provenance = {
  sourceKey: string;
  sourceUrl: string;
  sourceVersion: string;
  fetchedAt: string;
  pageSha256: string;
};

/** Stable hash of the normalized record, excluding provenance fields. */
export function recordHash(record: Record<string, unknown>): string {
  const keys = Object.keys(record)
    .filter((k) => !["sourceKey", "sourceUrl", "sourceVersion", "fetchedAt", "pageSha256", "recordHash"].includes(k))
    .sort();
  return sha256Hex(JSON.stringify(keys.map((k) => [k, record[k] ?? null])));
}
```

- [ ] **Step 4: Run** — `pnpm nx test sources` → PASS.

- [ ] **Step 5: Failing tests for Socrata parcels**

`libs/sources/src/socrata-parcels.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchParcelPages, fetchParcelVersion, PARCELS_URL } from "./socrata-parcels";

const page = readFileSync(join(__dirname, "../fixtures/parcels-page.json"), "utf8");

describe("socrata parcels", () => {
  it("reads dataset version", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ u: "2026-08-26T16:22:37.562Z" }])));
    expect(await fetchParcelVersion(fetcher)).toBe("2026-08-26T16:22:37.562Z");
    expect(fetcher.mock.calls[0]?.[0]).toContain(encodeURIComponent("max(:updated_at)"));
  });

  it("maps rows, drops bad APNs, stores page with hash, stops on short page", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(page)).mockResolvedValueOnce(new Response("[]"));
    const outDir = mkdtempSync(join(tmpdir(), "parcels-"));
    const pages = [];
    for await (const p of fetchParcelPages(fetcher, { pageSize: 3, outDir, sourceVersion: "v1", fetchedAt: "2026-10-08T00:00:00Z" })) pages.push(p);
    expect(pages).toHaveLength(1);
    const [p0] = pages;
    expect(p0?.rows).toHaveLength(2);
    expect(p0?.skippedNoApn).toBe(1);
    const first = p0?.rows[0];
    expect(first?.apn).toBe("27715017");
    expect(first?.situsAddress).toBe("382 RICHMOND AV");
    expect(first?.situsCity).toBe("SAN JOSE");
    expect(first?.lat).toBeCloseTo(37.32188, 4);
    expect(first?.sourceKey).toBe("scc-parcels");
    expect(first?.sourceUrl).toBe(`${PARCELS_URL}?$order=objectid&$limit=3&$offset=0`);
    expect(first?.pageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first?.recordHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

Fixture `libs/sources/fixtures/parcels-page.json` holds three objects in the live shape; the first is the `27715017` record shown in the spec probe, the second a valid APN with a `Polygon`, the third has `"apn": ""`.

- [ ] **Step 6: Run, expect failure.**

- [ ] **Step 7: Implement Socrata parcels**

`libs/sources/src/socrata-parcels.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bboxCenter, normalizeApn } from "@scc/domain";
import { sha256Hex } from "./hash";
import { fetchWithRetry, type Fetcher } from "./http";
import { recordHash, type Provenance } from "./provenance";

export const PARCELS_URL = "https://data.sccgov.org/resource/ubcd-cewv.json";
export const PARCELS_SOURCE_KEY = "scc-parcels";

export type ParcelRow = {
  apn: string;
  situsAddress: string | null;
  situsCity: string | null;
  situsZip: string | null;
  jurisdiction: string | null;
  taxRateArea: string | null;
  lat: number | null;
  lon: number | null;
} & Provenance & { recordHash: string };

type RawParcel = {
  apn?: string;
  objectid?: string;
  situs_house_number?: string;
  situs_street_name?: string;
  situs_street_type?: string;
  situs_city_name?: string;
  situs_zip_code?: string;
  jurisdiction?: string;
  tax_rate_area?: string;
  the_geom?: { type: string; coordinates: unknown };
};

export async function fetchParcelVersion(fetcher: Fetcher): Promise<string> {
  const url = `${PARCELS_URL}?$select=${encodeURIComponent("max(:updated_at) as u")}`;
  const res = await fetchWithRetry(fetcher, url);
  const [row] = (await res.json()) as Array<{ u: string }>;
  if (!row?.u) throw new Error("parcel dataset version unavailable");
  return row.u;
}

const clean = (s: string | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

export function mapParcel(raw: RawParcel, prov: Provenance): ParcelRow | null {
  const apn = normalizeApn(raw.apn);
  if (!apn) return null;
  const addressParts = [raw.situs_house_number, raw.situs_street_name, raw.situs_street_type].map((p) => (p ?? "").trim()).filter(Boolean);
  const center = raw.the_geom ? bboxCenter(raw.the_geom.coordinates) : null;
  const base = {
    apn,
    situsAddress: addressParts.length ? addressParts.join(" ") : null,
    situsCity: clean(raw.situs_city_name),
    situsZip: clean(raw.situs_zip_code),
    jurisdiction: clean(raw.jurisdiction),
    taxRateArea: clean(raw.tax_rate_area),
    lat: center?.lat ?? null,
    lon: center?.lon ?? null,
  };
  return { ...base, ...prov, recordHash: recordHash(base) };
}

export async function* fetchParcelPages(
  fetcher: Fetcher,
  opts: { pageSize?: number; maxPages?: number; outDir: string; sourceVersion: string; fetchedAt: string },
): AsyncGenerator<{ pageIndex: number; rows: ParcelRow[]; skippedNoApn: number }> {
  const pageSize = opts.pageSize ?? 50_000;
  await mkdir(opts.outDir, { recursive: true });
  for (let pageIndex = 0; pageIndex < (opts.maxPages ?? Infinity); pageIndex++) {
    const url = `${PARCELS_URL}?$order=objectid&$limit=${pageSize}&$offset=${pageIndex * pageSize}`;
    const res = await fetchWithRetry(fetcher, url, undefined, { retries: 4, baseDelayMs: 2000 });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const pageSha256 = sha256Hex(bytes);
    await writeFile(join(opts.outDir, `page-${String(pageIndex).padStart(4, "0")}.json`), bytes);
    const raws = JSON.parse(new TextDecoder().decode(bytes)) as RawParcel[];
    if (raws.length === 0) return;
    const prov: Provenance = { sourceKey: PARCELS_SOURCE_KEY, sourceUrl: url, sourceVersion: opts.sourceVersion, fetchedAt: opts.fetchedAt, pageSha256 };
    const rows: ParcelRow[] = [];
    let skippedNoApn = 0;
    for (const raw of raws) {
      const row = mapParcel(raw, prov);
      if (row) rows.push(row);
      else skippedNoApn++;
    }
    yield { pageIndex, rows, skippedNoApn };
    if (raws.length < pageSize) return;
  }
}
```

- [ ] **Step 8: Run** — PASS.

- [ ] **Step 9: Failing tests for CKAN permits**

`libs/sources/src/ckan-permits.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CKAN_PERMIT_RESOURCES, fetchCkanResourceVersion, parsePermitsCsv } from "./ckan-permits";

const fixtures = join(__dirname, "../fixtures");

describe("ckan permits", () => {
  it("reads last_modified of the CSV resource", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(readFileSync(join(fixtures, "ckan-package.json"))));
    expect(await fetchCkanResourceVersion(fetcher, CKAN_PERMIT_RESOURCES.active.packageId)).toBe("2026-10-07T16:00:08.000000");
  });

  it("parses rows into PermitRow with classification and contractor split", async () => {
    const rows = [];
    for await (const r of parsePermitsCsv(join(fixtures, "permits-active.csv"), { key: "active", sourceUrl: "u", sourceVersion: "v", fetchedAt: "t", pageSha256: "h" })) rows.push(r);
    expect(rows).toHaveLength(5);
    const roof = rows.find((r) => r.permitNumber === "2026-137661-RS");
    expect(roof).toMatchObject({
      status: "active",
      isRoofing: true,
      apn: "25934037",
      issueDate: "2026-09-14",
      finalDate: null,
      contractorCompany: "PEACH ROOFING SOLUTIONS INC",
      contractorContact: "Jason Nesbitt",
      valuation: 18500,
      address: "100 N 13TH ST , SAN JOSE CA 95112-3442",
    });
    const noApn = rows.find((r) => r.permitNumber === "2018-112785-IR");
    expect(noApn?.apn).toBeNull();
    expect(noApn?.isRoofing).toBe(false);
  });
});
```

Fixture `permits-active.csv` is the real header plus 5 rows taken from the live file: `2018-112785-IR` (no APN), `2026-137661-RS` (ReRoof, APN `259-34-037`, valuation `18500`), `2026-130149-CI` (ReRoof commercial), one Tenant Improvement, one with `FINALDATE` set. `permits-inspection.csv` repeats `2026-137661-RS` with `Status=UnderInspection` and two others.

- [ ] **Step 10: Run, expect failure.**

- [ ] **Step 11: Implement CKAN permits**

```bash
pnpm add csv-parse
```

`libs/sources/src/ckan-permits.ts`:

```ts
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "csv-parse";
import { isRoofingWork, normalizeApn, parseUsDate, splitContractor } from "@scc/domain";
import { sha256Hex } from "./hash";
import { fetchWithRetry, type Fetcher } from "./http";
import { recordHash, type Provenance } from "./provenance";

export type PermitStatusKey = "active" | "under_inspection" | "expired" | "last_30_days";
const CKAN = "https://data.sanjoseca.gov";

export const CKAN_PERMIT_RESOURCES: Record<PermitStatusKey, { packageId: string; downloadUrl: string }> = {
  active: { packageId: "active-building-permits", downloadUrl: `${CKAN}/dataset/fd9ceb0c-75e0-402e-9fe3-3f6e04f2c23f/resource/761b7ae8-3be1-4ad6-923d-c7af6404a904/download/buildingpermitsactive.csv` },
  under_inspection: { packageId: "building-permits-under-inspection", downloadUrl: `${CKAN}/dataset/ca355e55-c651-4e00-9bde-2c014f229486/resource/89ccdad9-7309-4826-a5f3-2fcf1fcb20fa/download/buildingpermitsunderinspection.csv` },
  expired: { packageId: "expired-building-permits", downloadUrl: `${CKAN}/dataset/3b40d486-bd19-44c5-b854-5f0638c2afc3/resource/df4b8461-0c7a-4d16-b85d-ff7f71c5fed5/download/buildingpermitsexpired.csv` },
  last_30_days: { packageId: "last-30-days-building-permits", downloadUrl: `${CKAN}/dataset/2723cdec-a639-4b63-bded-175338c45473/resource/045b3678-e923-4002-b696-300955bc6d06/download/buildingpermits30.csv` },
};

export const PERMITS_SOURCE_KEY_PREFIX = "sj-permits-";

export async function fetchCkanResourceVersion(fetcher: Fetcher, packageId: string): Promise<string> {
  const res = await fetchWithRetry(fetcher, `${CKAN}/api/3/action/package_show?id=${packageId}`);
  const body = (await res.json()) as { result: { resources: Array<{ format: string; last_modified: string }> } };
  const csv = body.result.resources.find((r) => r.format === "CSV");
  if (!csv?.last_modified) throw new Error(`no CSV resource for ${packageId}`);
  return csv.last_modified;
}

export async function downloadPermitsCsv(fetcher: Fetcher, key: PermitStatusKey, outDir: string) {
  await mkdir(outDir, { recursive: true });
  const res = await fetchWithRetry(fetcher, CKAN_PERMIT_RESOURCES[key].downloadUrl, undefined, { retries: 4, baseDelayMs: 2000 });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const path = join(outDir, `${key}.csv`);
  await writeFile(path, bytes);
  return { path, sha256: sha256Hex(bytes), bytes: bytes.length };
}

export type PermitRow = {
  permitNumber: string;
  apn: string | null;
  status: "active" | "under_inspection" | "expired";
  isRoofing: boolean;
  workDescription: string | null;
  subtype: string | null;
  folderName: string | null;
  approvals: string | null;
  issueDate: string | null;
  finalDate: string | null;
  valuation: number | null;
  address: string | null;
  applicant: string | null;
  ownerNameRaw: string | null;
  contractorRaw: string | null;
  contractorCompany: string | null;
  contractorContact: string | null;
  folderRsn: string | null;
} & Provenance & { recordHash: string };

const STATUS_BY_CSV: Record<string, PermitRow["status"]> = { Active: "active", UnderInspection: "under_inspection", Expired: "expired" };

const clean = (s: string | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

export function mapPermit(raw: Record<string, string>, key: PermitStatusKey, prov: Provenance): PermitRow | null {
  const permitNumber = clean(raw.FOLDERNUMBER);
  if (!permitNumber) return null;
  const status = STATUS_BY_CSV[raw.Status ?? ""] ?? (key === "last_30_days" ? "active" : null);
  if (!status) return null;
  const contractor = splitContractor(raw.CONTRACTOR ?? "");
  const workDescription = clean(raw.WORKDESCRIPTION);
  const subtype = clean(raw.SUBTYPEDESCRIPTION);
  const folderName = clean(raw.FOLDERNAME);
  const valuationNum = Number((raw.PERMITVALUATION ?? "").replace(/[^0-9.]/g, ""));
  const base = {
    permitNumber,
    apn: normalizeApn(raw.ASSESSORS_PARCEL_NUMBER),
    status,
    isRoofing: isRoofingWork({ workDescription: workDescription ?? undefined, subtype: subtype ?? undefined, folderName: folderName ?? undefined }),
    workDescription,
    subtype,
    folderName,
    approvals: clean(raw.PERMITAPPROVALS),
    issueDate: parseUsDate(raw.ISSUEDATE),
    finalDate: parseUsDate(raw.FINALDATE),
    valuation: raw.PERMITVALUATION && Number.isFinite(valuationNum) && valuationNum > 0 ? valuationNum : null,
    address: clean(raw.gx_location)?.replace(/^,\s*|\s*,$/g, "") ?? null,
    applicant: clean(raw.APPLICANT),
    ownerNameRaw: clean(raw.OWNERNAME) === "NONE" ? null : clean(raw.OWNERNAME),
    contractorRaw: clean(raw.CONTRACTOR),
    contractorCompany: contractor.companyName,
    contractorContact: contractor.contactName,
    folderRsn: clean(raw.FOLDERRSN),
  };
  return { ...base, ...prov, recordHash: recordHash(base) };
}

export async function* parsePermitsCsv(
  path: string,
  meta: { key: PermitStatusKey; sourceUrl: string; sourceVersion: string; fetchedAt: string; pageSha256: string },
): AsyncGenerator<PermitRow> {
  const prov: Provenance = { sourceKey: `${PERMITS_SOURCE_KEY_PREFIX}${meta.key}`, sourceUrl: meta.sourceUrl, sourceVersion: meta.sourceVersion, fetchedAt: meta.fetchedAt, pageSha256: meta.pageSha256 };
  const parser = createReadStream(path).pipe(parse({ columns: true, bom: true, relax_column_count: true, trim: false }));
  for await (const raw of parser as AsyncIterable<Record<string, string>>) {
    const row = mapPermit(raw, meta.key, prov);
    if (row) yield row;
  }
}
```

Note `address`: `gx_location` of `"     ,   "` cleans to `","` → strip leading/trailing commas → empty → `null`. Add a unit assertion for that in the test (`noApn?.address` is `null`).

- [ ] **Step 12: Run tests, lint, typecheck** — `pnpm nx run-many -t test lint typecheck -p sources` → PASS.

- [ ] **Step 13: Commit**

```bash
git add libs/sources
git commit -m "feat(sources): socrata parcel and san jose ckan permit fetchers with provenance"
```

---

### Task 4: DuckDB store, ingest with deltas, derived tables

**Files:**
- Create: `apps/pipeline/src/db/schema.sql`, `apps/pipeline/src/db/duck.ts`, `apps/pipeline/src/db/upsert.ts`, `apps/pipeline/src/db/derive.ts`, `apps/pipeline/src/commands/ingest.ts`, `apps/pipeline/src/run-id.ts`, `apps/pipeline/src/cli.ts`, `apps/pipeline/project.json` (add `cli` target), `apps/pipeline/src/env.ts`
- Test: `apps/pipeline/src/db/upsert.test.ts`, `apps/pipeline/src/db/derive.test.ts`, `apps/pipeline/src/commands/ingest.test.ts`
- Fixtures: `apps/pipeline/fixtures/day1/` and `apps/pipeline/fixtures/day2/` each with `parcels-page.json`, `active.csv`, `under_inspection.csv`, `expired.csv`, `last_30_days.csv`, `versions.json` (`{ "scc-parcels": "...", "sj-permits-active": "...", ... }`). Day 2 changes one permit's status, adds one permit, removes one parcel.

**Interfaces:**
- Consumes: `@scc/sources` fetchers (with injectable `Fetcher`), `@scc/domain` rules.
- Produces:
  - `openDb(path: string | ":memory:"): Promise<Db>` where `Db = { run(sql: string, params?: unknown[]): Promise<void>; all<T>(sql: string, params?: unknown[]): Promise<T[]>; close(): Promise<void> }`
  - `applySchema(db: Db): Promise<void>`
  - `upsertTable(db, opts: { table: "properties" | "permits"; stagingNdjsonPath: string; key: string; runId: string; fullSource: boolean }): Promise<Delta>` with `Delta = { fetched: number; inserted: number; updated: number; unchanged: number; removed: number }`
  - `deriveAll(db, asOf: string): Promise<{ roofAgeRows: number; contractors: number; owners: number }>`
  - `ingest(opts: { db: Db; fetcher: Fetcher; dataDir: string; runId: string; asOf: string; now: string; window?: "last_30_days" | "full"; sourcesOverride?: SourceInputs }): Promise<RunRecord>`
  - `type RunRecord = { runId; startedAt; finishedAt; asOf; status: "complete" | "partial"; sources: Record<string, { sourceVersion: string; skipped: boolean } & Delta>; totals: { properties; permits; roofingPermits; contractors; owners; roofAge }; limitations: string[]; previousRunId: string | null }`
  - `newRunId(now: Date): string` → `2026-10-08T01-15-00Z`

- [ ] **Step 1: Schema**

`apps/pipeline/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS properties (
  apn TEXT PRIMARY KEY,
  situs_address TEXT, situs_city TEXT, situs_zip TEXT, jurisdiction TEXT, tax_rate_area TEXT,
  lat DOUBLE, lon DOUBLE,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL, page_sha256 TEXT NOT NULL, record_hash TEXT NOT NULL,
  first_seen_run TEXT NOT NULL, last_seen_run TEXT NOT NULL, last_changed_run TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS permits (
  permit_number TEXT PRIMARY KEY,
  apn TEXT, status TEXT NOT NULL, permit_state TEXT, is_roofing BOOLEAN NOT NULL,
  work_description TEXT, subtype TEXT, folder_name TEXT, approvals TEXT,
  issue_date DATE, final_date DATE, days_open INTEGER, valuation DOUBLE,
  address TEXT, applicant TEXT, owner_name_raw TEXT, contractor_raw TEXT,
  contractor_company TEXT, contractor_contact TEXT, contractor_id TEXT, folder_rsn TEXT,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL, page_sha256 TEXT NOT NULL, record_hash TEXT NOT NULL,
  first_seen_run TEXT NOT NULL, last_seen_run TEXT NOT NULL, last_changed_run TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contractors (
  contractor_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, contact_name TEXT,
  permit_count INTEGER NOT NULL, roofing_permit_count INTEGER NOT NULL,
  cslb_license_number TEXT, cslb_status TEXT, cslb_match_method TEXT, bbb_rating TEXT,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS owners (
  apn TEXT NOT NULL, owner_name TEXT NOT NULL, observed_on DATE, permit_number TEXT NOT NULL,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TIMESTAMP NOT NULL,
  PRIMARY KEY (apn, permit_number)
);
CREATE TABLE IF NOT EXISTS roof_age (
  apn TEXT PRIMARY KEY, roof_date DATE NOT NULL, roof_age_years INTEGER NOT NULL,
  anchor TEXT NOT NULL, confidence TEXT NOT NULL, permit_number TEXT NOT NULL,
  source_key TEXT NOT NULL, source_url TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, started_at TIMESTAMP NOT NULL, finished_at TIMESTAMP, as_of DATE NOT NULL,
  status TEXT NOT NULL, record JSON NOT NULL, manifest_cid TEXT, previous_run_id TEXT
);
```

- [ ] **Step 2: Failing test for the DuckDB wrapper + schema**

`apps/pipeline/src/db/duck.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "./duck";

describe("duck", () => {
  it("opens in-memory db, applies schema, round-trips a row", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    await db.run("INSERT INTO runs VALUES (?, ?, NULL, ?, 'complete', '{}', NULL, NULL)", ["r1", "2026-10-08 00:00:00", "2026-10-08"]);
    const rows = await db.all<{ run_id: string }>("SELECT run_id FROM runs");
    expect(rows).toEqual([{ run_id: "r1" }]);
    await db.close();
  });
});
```

- [ ] **Step 3: Implement wrapper**

```bash
pnpm add @duckdb/node-api
```

`apps/pipeline/src/db/duck.ts`:

```ts
import { readFile } from "node:fs/promises";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export type Db = {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
};

export async function openDb(path: string): Promise<Db> {
  const instance = await DuckDBInstance.create(path);
  const conn: DuckDBConnection = await instance.connect();
  const bind = async (sql: string, params?: unknown[]) => {
    const prepared = await conn.prepare(sql);
    if (params) prepared.bind(params as never);
    return prepared;
  };
  return {
    async run(sql, params) {
      if (!params) { await conn.run(sql); return; }
      const p = await bind(sql, params);
      await p.run();
    },
    async all<T>(sql: string, params?: unknown[]) {
      const reader = params ? await (await bind(sql, params)).runAndReadAll() : await conn.runAndReadAll(sql);
      return reader.getRowObjectsJson() as T[];
    },
    async close() { conn.closeSync(); instance.closeSync(); },
  };
}

export async function applySchema(db: Db): Promise<void> {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) await db.run(stmt);
}
```

(If `getRowObjectsJson` is not available in the installed version, use `getRowObjects()` and convert `DuckDBValue` with `.toString()` for dates/timestamps; keep the test as the contract.)

- [ ] **Step 4: Run** — `pnpm nx test pipeline` → PASS.

- [ ] **Step 5: Failing test for upsert deltas and dedupe precedence**

`apps/pipeline/src/db/upsert.test.ts`:

```ts
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "./duck";
import { upsertTable } from "./upsert";

const prov = { source_key: "sj-permits-active", source_url: "u", source_version: "v1", fetched_at: "2026-10-08 00:00:00", page_sha256: "h" };
const permit = (over: Record<string, unknown>) => ({
  permit_number: "P1", apn: "27715017", status: "active", is_roofing: true, work_description: "ReRoof", subtype: null, folder_name: null,
  approvals: "B-Complete", issue_date: "2026-08-14", final_date: null, valuation: 100, address: "a", applicant: null, owner_name_raw: "O",
  contractor_raw: "C", contractor_company: "C", contractor_contact: null, folder_rsn: null, record_hash: "hash1", ...prov, ...over,
});

function ndjson(dir: string, name: string, rows: object[]) {
  const p = join(dir, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

describe("upsertTable", () => {
  it("inserts, then reports unchanged, updated and removed on full reloads", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const dir = mkdtempSync(join(tmpdir(), "upsert-"));

    const d1 = await upsertTable(db, { table: "permits", stagingNdjsonPath: ndjson(dir, "a.ndjson", [permit({}), permit({ permit_number: "P2", record_hash: "hash2" })]), key: "permit_number", runId: "r1", fullSource: true });
    expect(d1).toEqual({ fetched: 2, inserted: 2, updated: 0, unchanged: 0, removed: 0 });

    const d2 = await upsertTable(db, { table: "permits", stagingNdjsonPath: ndjson(dir, "b.ndjson", [permit({}), permit({ permit_number: "P2", record_hash: "hash2" })]), key: "permit_number", runId: "r2", fullSource: true });
    expect(d2).toEqual({ fetched: 2, inserted: 0, updated: 0, unchanged: 2, removed: 0 });

    const d3 = await upsertTable(db, { table: "permits", stagingNdjsonPath: ndjson(dir, "c.ndjson", [permit({ status: "under_inspection", record_hash: "hash1b" }), permit({ permit_number: "P3", record_hash: "hash3" })]), key: "permit_number", runId: "r3", fullSource: true });
    expect(d3).toEqual({ fetched: 2, inserted: 1, updated: 1, unchanged: 0, removed: 1 });
    const rows = await db.all<{ permit_number: string; status: string; last_changed_run: string }>("SELECT permit_number, status, last_changed_run FROM permits ORDER BY 1");
    expect(rows).toEqual([
      { permit_number: "P1", status: "under_inspection", last_changed_run: "r3" },
      { permit_number: "P3", status: "active", last_changed_run: "r3" },
    ]);
    await db.close();
  });

  it("keeps the highest-precedence duplicate within one staging file", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const dir = mkdtempSync(join(tmpdir(), "upsert-"));
    await upsertTable(db, { table: "permits", stagingNdjsonPath: ndjson(dir, "a.ndjson", [permit({ status: "active", record_hash: "a" }), permit({ status: "expired", record_hash: "e" }), permit({ status: "under_inspection", record_hash: "u" })]), key: "permit_number", runId: "r1", fullSource: true });
    const rows = await db.all<{ status: string }>("SELECT status FROM permits");
    expect(rows).toEqual([{ status: "under_inspection" }]);
    await db.close();
  });
});
```

- [ ] **Step 6: Implement upsert**

`apps/pipeline/src/db/upsert.ts`:

```ts
import type { Db } from "./duck";

export type Delta = { fetched: number; inserted: number; updated: number; unchanged: number; removed: number };

const COLUMNS: Record<"properties" | "permits", string[]> = {
  properties: ["apn", "situs_address", "situs_city", "situs_zip", "jurisdiction", "tax_rate_area", "lat", "lon", "source_key", "source_url", "source_version", "fetched_at", "page_sha256", "record_hash"],
  permits: ["permit_number", "apn", "status", "is_roofing", "work_description", "subtype", "folder_name", "approvals", "issue_date", "final_date", "valuation", "address", "applicant", "owner_name_raw", "contractor_raw", "contractor_company", "contractor_contact", "folder_rsn", "source_key", "source_url", "source_version", "fetched_at", "page_sha256", "record_hash"],
};

const STATUS_RANK = "CASE status WHEN 'under_inspection' THEN 3 WHEN 'active' THEN 2 WHEN 'expired' THEN 1 ELSE 0 END";

export async function upsertTable(
  db: Db,
  opts: { table: "properties" | "permits"; stagingNdjsonPath: string; key: string; runId: string; fullSource: boolean },
): Promise<Delta> {
  const { table, key, runId } = opts;
  const cols = COLUMNS[table];
  const colList = cols.join(", ");
  await db.run("DROP TABLE IF EXISTS staging_raw; DROP TABLE IF EXISTS staging");
  await db.run(`CREATE TEMP TABLE staging_raw AS SELECT ${colList} FROM read_json_auto('${opts.stagingNdjsonPath}', format='newline_delimited')`);
  const fetched = (await db.all<{ n: number }>("SELECT count(*)::INT AS n FROM staging_raw"))[0]?.n ?? 0;
  const rank = table === "permits" ? STATUS_RANK : "1";
  await db.run(`CREATE TEMP TABLE staging AS SELECT * EXCLUDE (rn) FROM (SELECT *, row_number() OVER (PARTITION BY ${key} ORDER BY ${rank} DESC) AS rn FROM staging_raw) WHERE rn = 1`);

  const count = async (sql: string) => (await db.all<{ n: number }>(sql))[0]?.n ?? 0;
  const inserted = await count(`SELECT count(*)::INT AS n FROM staging s LEFT JOIN ${table} t USING (${key}) WHERE t.${key} IS NULL`);
  const updated = await count(`SELECT count(*)::INT AS n FROM staging s JOIN ${table} t USING (${key}) WHERE s.record_hash <> t.record_hash`);
  const unchanged = await count(`SELECT count(*)::INT AS n FROM staging s JOIN ${table} t USING (${key}) WHERE s.record_hash = t.record_hash`);
  let removed = 0;
  if (opts.fullSource) {
    removed = await count(`SELECT count(*)::INT AS n FROM ${table} t LEFT JOIN staging s USING (${key}) WHERE s.${key} IS NULL`);
    await db.run(`DELETE FROM ${table} WHERE ${key} NOT IN (SELECT ${key} FROM staging)`);
  }
  const setList = cols.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`).join(", ");
  await db.run(
    `INSERT INTO ${table} (${colList}, first_seen_run, last_seen_run, last_changed_run)
     SELECT ${colList}, '${runId}', '${runId}', '${runId}' FROM staging
     ON CONFLICT (${key}) DO UPDATE SET ${setList},
       last_seen_run = '${runId}',
       last_changed_run = CASE WHEN ${table}.record_hash <> excluded.record_hash THEN '${runId}' ELSE ${table}.last_changed_run END`,
  );
  await db.run("DROP TABLE staging_raw; DROP TABLE staging");
  return { fetched, inserted, updated, unchanged, removed };
}
```

- [ ] **Step 7: Run** — PASS. (If `read_json_auto` infers `is_roofing` or dates as the wrong type, pass `columns={...}` explicitly built from a `TYPES` map; keep the tests unchanged.)

- [ ] **Step 8: Failing test for derive**

`apps/pipeline/src/db/derive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "./duck";
import { deriveAll } from "./derive";

describe("deriveAll", () => {
  it("computes permit_state/days_open, roof_age, contractors, owners", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const prov = "'sj-permits-active','u','v','2026-10-08 00:00:00','h'";
    await db.run(`INSERT INTO permits (permit_number, apn, status, is_roofing, approvals, issue_date, final_date, owner_name_raw, contractor_company, contractor_contact, source_key, source_url, source_version, fetched_at, page_sha256, record_hash, first_seen_run, last_seen_run, last_changed_run) VALUES
      ('P1','27715017','active',true,'B-Complete','2026-08-14',NULL,'ALICE','PEACH ROOFING SOLUTIONS INC','Jason',${prov},'x','r1','r1','r1'),
      ('P2','27715017','expired',true,'B-Complete','2009-05-01','2009-06-01','BOB','Peach Roofing Solutions, Inc.',NULL,${prov},'y','r1','r1','r1'),
      ('P3','11111111','expired',false,'',  '2015-01-01',NULL,NULL,'OTHER CO',NULL,${prov},'z','r1','r1','r1')`);
    const stats = await deriveAll(db, "2026-10-08");
    expect(stats).toEqual({ roofAgeRows: 1, contractors: 2, owners: 2 });
    const p = await db.all<{ permit_number: string; permit_state: string; days_open: number; contractor_id: string | null }>("SELECT permit_number, permit_state, days_open, contractor_id FROM permits ORDER BY 1");
    expect(p.map((r) => r.permit_state)).toEqual(["open", "finaled", "expired_unfinaled"]);
    expect(p[0]?.days_open).toBe(55);
    expect(p[0]?.contractor_id).toBe(p[1]?.contractor_id);
    const roof = await db.all<{ apn: string; roof_age_years: number; anchor: string }>("SELECT apn, roof_age_years, anchor FROM roof_age");
    expect(roof).toEqual([{ apn: "27715017", roof_age_years: 0, anchor: "approval_complete_issue_date" }]);
    const c = await db.all<{ company_name: string; roofing_permit_count: number }>("SELECT company_name, roofing_permit_count FROM contractors ORDER BY 2 DESC");
    expect(c[0]?.roofing_permit_count).toBe(2);
    await db.close();
  });
});
```

Roof age picks the **newest** roofing evidence per APN (P1 issue 2026-08-14 with Complete approval beats P2 final 2009-06-01), which is the behavior consumers want ("current roof").

- [ ] **Step 9: Implement derive**

`apps/pipeline/src/db/derive.ts`:

```ts
import { contractorId, daysOpen, derivePermitState, deriveRoofAge } from "@scc/domain";
import type { Db } from "./duck";

type PermitLite = { permit_number: string; apn: string | null; status: "active" | "under_inspection" | "expired"; is_roofing: boolean; approvals: string | null; issue_date: string | null; final_date: string | null; owner_name_raw: string | null; contractor_company: string | null; contractor_contact: string | null; source_key: string; source_url: string; source_version: string; fetched_at: string };

export async function deriveAll(db: Db, asOf: string): Promise<{ roofAgeRows: number; contractors: number; owners: number }> {
  const permits = await db.all<PermitLite>("SELECT permit_number, apn, status, is_roofing, approvals, issue_date::TEXT AS issue_date, final_date::TEXT AS final_date, owner_name_raw, contractor_company, contractor_contact, source_key, source_url, source_version, fetched_at::TEXT AS fetched_at FROM permits");

  // 1. permit_state, days_open, contractor_id — batched UPDATE via a temp table
  const updates = permits.map((p) => {
    const state = derivePermitState({ status: p.status, finalDate: p.final_date });
    return { permit_number: p.permit_number, permit_state: state, days_open: daysOpen({ state, issueDate: p.issue_date, finalDate: p.final_date, asOf }), contractor_id: p.contractor_company ? contractorId(p.contractor_company) : null };
  });
  await loadTemp(db, "permit_updates", updates);
  await db.run("UPDATE permits SET permit_state = u.permit_state, days_open = u.days_open, contractor_id = u.contractor_id FROM permit_updates u WHERE permits.permit_number = u.permit_number");

  // 2. roof_age — newest evidence per APN
  const best = new Map<string, { row: PermitLite; roof: NonNullable<ReturnType<typeof deriveRoofAge>> }>();
  for (const p of permits) {
    if (!p.apn) continue;
    const roof = deriveRoofAge({ isRoofing: p.is_roofing, approvals: p.approvals, issueDate: p.issue_date, finalDate: p.final_date, asOf });
    if (!roof) continue;
    const prev = best.get(p.apn);
    if (!prev || roof.roofDate > prev.roof.roofDate) best.set(p.apn, { row: p, roof });
  }
  await db.run("DELETE FROM roof_age");
  await loadTemp(db, "roof_rows", [...best.entries()].map(([apn, { row, roof }]) => ({ apn, roof_date: roof.roofDate, roof_age_years: roof.roofAgeYears, anchor: roof.anchor, confidence: roof.confidence, permit_number: row.permit_number, source_key: row.source_key, source_url: row.source_url, source_version: row.source_version, fetched_at: row.fetched_at })));
  await db.run("INSERT INTO roof_age SELECT * FROM roof_rows");

  // 3. contractors — aggregate by contractor_id
  await db.run("DELETE FROM contractors");
  await db.run(`INSERT INTO contractors
    SELECT contractor_id, arg_max(contractor_company, fetched_at), arg_max(contractor_contact, fetched_at), count(*)::INT, sum(CASE WHEN is_roofing THEN 1 ELSE 0 END)::INT,
           NULL, NULL, NULL, NULL, 'sj-permits', 'https://data.sanjoseca.gov/dataset/active-building-permits', max(source_version), max(fetched_at)
    FROM permits WHERE contractor_id IS NOT NULL GROUP BY contractor_id`);

  // 4. owners — one observation per (apn, permit)
  await db.run("DELETE FROM owners");
  await db.run("INSERT INTO owners SELECT apn, owner_name_raw, issue_date, permit_number, source_key, source_url, source_version, fetched_at FROM permits WHERE apn IS NOT NULL AND owner_name_raw IS NOT NULL");

  const n = async (t: string) => (await db.all<{ n: number }>(`SELECT count(*)::INT AS n FROM ${t}`))[0]?.n ?? 0;
  return { roofAgeRows: await n("roof_age"), contractors: await n("contractors"), owners: await n("owners") };
}

async function loadTemp(db: Db, name: string, rows: object[]): Promise<void> {
  const { writeFile, mkdtemp } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "scc-"));
  const path = join(dir, `${name}.ndjson`);
  await writeFile(path, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  await db.run(`DROP TABLE IF EXISTS ${name}`);
  if (rows.length === 0) {
    await db.run(`CREATE TEMP TABLE ${name} AS SELECT * FROM roof_age WHERE false`);
    return;
  }
  await db.run(`CREATE TEMP TABLE ${name} AS SELECT * FROM read_json_auto('${path}', format='newline_delimited')`);
}
```

(`loadTemp` for an empty `permit_updates` must create the right shape; simplest is to always write at least the header-less file and special-case `rows.length === 0` per table — write `CREATE TEMP TABLE permit_updates (permit_number TEXT, permit_state TEXT, days_open INTEGER, contractor_id TEXT)` and `CREATE TEMP TABLE roof_rows AS SELECT * FROM roof_age WHERE false` explicitly, keyed by `name`.)

- [ ] **Step 10: Run** — PASS.

- [ ] **Step 11: Failing integration test for `ingest` with day1/day2 fixtures**

`apps/pipeline/src/commands/ingest.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "../db/duck";
import { ingest } from "./ingest";
import { fixtureFetcher } from "../test/fixture-fetcher";

const fx = (day: string) => join(__dirname, "../../fixtures", day);

describe("ingest", () => {
  it("day1 loads everything; day2 records deltas; day2 again is unchanged", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const dataDir = mkdtempSync(join(tmpdir(), "ingest-"));

    const r1 = await ingest({ db, fetcher: fixtureFetcher(fx("day1")), dataDir, runId: "r1", asOf: "2026-10-08", now: "2026-10-08T01:00:00Z" });
    expect(r1.status).toBe("complete");
    expect(r1.sources["scc-parcels"]).toMatchObject({ inserted: 3, removed: 0, skipped: false });
    expect(r1.sources["sj-permits-active"]).toMatchObject({ inserted: 4 });
    expect(r1.totals.roofingPermits).toBe(2);
    expect(r1.previousRunId).toBeNull();

    const r2 = await ingest({ db, fetcher: fixtureFetcher(fx("day2")), dataDir, runId: "r2", asOf: "2026-10-09", now: "2026-10-09T01:00:00Z" });
    expect(r2.sources["scc-parcels"]).toMatchObject({ inserted: 0, updated: 0, unchanged: 2, removed: 1 });
    expect(r2.sources["sj-permits-active"]).toMatchObject({ inserted: 1, updated: 1 });
    expect(r2.previousRunId).toBe("r1");

    const r3 = await ingest({ db, fetcher: fixtureFetcher(fx("day2")), dataDir, runId: "r3", asOf: "2026-10-10", now: "2026-10-10T01:00:00Z" });
    expect(Object.values(r3.sources).every((s) => s.skipped)).toBe(true);
    expect((await db.all<{ n: number }>("SELECT count(*)::INT AS n FROM runs"))[0]?.n).toBe(3);
    await db.close();
  });
});
```

`apps/pipeline/src/test/fixture-fetcher.ts` maps URLs to fixture files: Socrata version query → `versions.json["scc-parcels"]`, Socrata page offset 0 → `parcels-page.json`, offset > 0 → `[]`; CKAN `package_show?id=X` → a synthesized `{result:{resources:[{format:"CSV",last_modified: versions.json[key]}]}}`; CKAN download URL → the CSV file. Anything else → 404 Response.

- [ ] **Step 12: Implement `ingest`, run id, CLI**

`apps/pipeline/src/run-id.ts`:

```ts
export function newRunId(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}
```

`apps/pipeline/src/commands/ingest.ts` (core logic; `permits` sources are merged into one staging file so the dedupe precedence works across CSVs):

```ts
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { CKAN_PERMIT_RESOURCES, downloadPermitsCsv, fetchCkanResourceVersion, fetchParcelPages, fetchParcelVersion, parsePermitsCsv, PARCELS_SOURCE_KEY, PERMITS_SOURCE_KEY_PREFIX, type Fetcher, type PermitStatusKey } from "@scc/sources";
import { deriveAll } from "../db/derive";
import type { Db } from "../db/duck";
import { upsertTable, type Delta } from "../db/upsert";

export type SourceStat = Delta & { sourceVersion: string; skipped: boolean; error?: string };
export type RunRecord = {
  runId: string; startedAt: string; finishedAt: string; asOf: string; status: "complete" | "partial";
  sources: Record<string, SourceStat>;
  totals: { properties: number; permits: number; roofingPermits: number; contractors: number; owners: number; roofAge: number };
  limitations: string[]; previousRunId: string | null; manifestCid: string | null;
};

const ZERO: Delta = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, removed: 0 };
const PERMIT_KEYS: PermitStatusKey[] = ["active", "under_inspection", "expired"];

const STATIC_LIMITATIONS = [
  "Permits cover the City of San José only; the other 15 jurisdictions have no open bulk feed in this milestone.",
  "No public owner mailing address or transfer date (Assessor roll is paid); ownership is observed from permit records.",
  "No public year-built field; roof age is derived only from completed roofing permits.",
  "BBB ratings are not publicly downloadable; bbb_rating is always null.",
];

export async function ingest(opts: { db: Db; fetcher: Fetcher; dataDir: string; runId: string; asOf: string; now: string }): Promise<RunRecord> {
  const { db, fetcher, runId, asOf, now } = opts;
  const rawDir = join(opts.dataDir, "raw", runId);
  await mkdir(rawDir, { recursive: true });
  const prev = (await db.all<{ run_id: string; record: string }>("SELECT run_id, record FROM runs ORDER BY started_at DESC LIMIT 1"))[0];
  const prevRecord = prev ? (JSON.parse(prev.record) as RunRecord) : null;
  const sources: Record<string, SourceStat> = {};
  const limitations = [...STATIC_LIMITATIONS];
  let status: RunRecord["status"] = "complete";

  // parcels
  try {
    const version = await fetchParcelVersion(fetcher);
    if (prevRecord?.sources[PARCELS_SOURCE_KEY]?.sourceVersion === version) {
      sources[PARCELS_SOURCE_KEY] = { ...ZERO, sourceVersion: version, skipped: true };
    } else {
      const staging = join(rawDir, "parcels.ndjson");
      await writeFile(staging, "");
      for await (const page of fetchParcelPages(fetcher, { outDir: join(rawDir, PARCELS_SOURCE_KEY), sourceVersion: version, fetchedAt: now })) {
        await appendFile(staging, page.rows.map((r) => JSON.stringify(toSnake(r))).join("\n") + "\n");
      }
      const delta = await upsertTable(db, { table: "properties", stagingNdjsonPath: staging, key: "apn", runId, fullSource: true });
      sources[PARCELS_SOURCE_KEY] = { ...delta, sourceVersion: version, skipped: false };
    }
  } catch (err) {
    status = "partial";
    sources[PARCELS_SOURCE_KEY] = { ...ZERO, sourceVersion: "", skipped: false, error: String(err) };
    limitations.push(`scc-parcels failed: ${String(err)}`);
  }

  // permits: all three status files into one staging file (dedupe precedence inside upsert)
  const staging = join(rawDir, "permits.ndjson");
  await writeFile(staging, "");
  let anyPermitChange = false;
  for (const key of PERMIT_KEYS) {
    const sourceKey = `${PERMITS_SOURCE_KEY_PREFIX}${key}`;
    try {
      const version = await fetchCkanResourceVersion(fetcher, CKAN_PERMIT_RESOURCES[key].packageId);
      const file = await downloadPermitsCsv(fetcher, key, join(rawDir, "permits"));
      let fetched = 0;
      for await (const row of parsePermitsCsv(file.path, { key, sourceUrl: CKAN_PERMIT_RESOURCES[key].downloadUrl, sourceVersion: version, fetchedAt: now, pageSha256: file.sha256 })) {
        await appendFile(staging, JSON.stringify(toSnake(row)) + "\n");
        fetched++;
      }
      const skipped = prevRecord?.sources[sourceKey]?.sourceVersion === version;
      anyPermitChange ||= !skipped;
      sources[sourceKey] = { ...ZERO, fetched, sourceVersion: version, skipped };
    } catch (err) {
      status = "partial";
      sources[sourceKey] = { ...ZERO, sourceVersion: "", skipped: false, error: String(err) };
      limitations.push(`${sourceKey} failed: ${String(err)}`);
    }
  }
  if (anyPermitChange) {
    const delta = await upsertTable(db, { table: "permits", stagingNdjsonPath: staging, key: "permit_number", runId, fullSource: true });
    // attribute deltas to the combined feed; per-file counts stay in `fetched`
    sources["sj-permits"] = { ...delta, sourceVersion: PERMIT_KEYS.map((k) => sources[`${PERMITS_SOURCE_KEY_PREFIX}${k}`]?.sourceVersion ?? "").join("|"), skipped: false };
  }

  const derived = await deriveAll(db, asOf);
  const n = async (sql: string) => (await db.all<{ n: number }>(sql))[0]?.n ?? 0;
  const record: RunRecord = {
    runId, startedAt: now, finishedAt: new Date().toISOString(), asOf, status, sources,
    totals: { properties: await n("SELECT count(*)::INT n FROM properties"), permits: await n("SELECT count(*)::INT n FROM permits"), roofingPermits: await n("SELECT count(*)::INT n FROM permits WHERE is_roofing"), contractors: derived.contractors, owners: derived.owners, roofAge: derived.roofAgeRows },
    limitations, previousRunId: prev?.run_id ?? null, manifestCid: null,
  };
  await db.run("INSERT INTO runs (run_id, started_at, finished_at, as_of, status, record, manifest_cid, previous_run_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)", [runId, now, record.finishedAt, asOf, status, JSON.stringify(record), record.previousRunId]);
  return record;
}

function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]));
}
```

Adjust the integration test expectations to the keys above (`sj-permits-active.fetched`, `sj-permits.inserted`), keeping the spirit: day1 inserts, day2 deltas, day2-again all skipped.

`apps/pipeline/src/cli.ts` (commander-free, plain `process.argv`):

```ts
import { config } from "dotenv";
import { join } from "node:path";
import { applySchema, openDb } from "./db/duck";
import { ingest } from "./commands/ingest";
import { newRunId } from "./run-id";

config({ path: join(process.cwd(), ".env") });

const [, , cmd = "help"] = process.argv;
const dataDir = process.env.SCC_DATA_DIR ?? join(process.cwd(), "data");
const dbPath = join(dataDir, "santa-clara.duckdb");

async function main() {
  const now = new Date();
  const runId = newRunId(now);
  if (cmd === "ingest" || cmd === "run") {
    const db = await openDb(dbPath);
    await applySchema(db);
    const record = await ingest({ db, fetcher: fetch, dataDir, runId, asOf: now.toISOString().slice(0, 10), now: now.toISOString() });
    console.log(JSON.stringify(record, null, 2));
    await db.close();
    return;
  }
  console.log("usage: pipeline <ingest|export|publish|verify|sync|run>");
}
main().catch((err) => { console.error(err); process.exit(1); });
```

```bash
pnpm add dotenv tsx
```

Add to `apps/pipeline/project.json`: `"cli": { "command": "tsx apps/pipeline/src/cli.ts", "options": { "cwd": "{workspaceRoot}" } }` so `pnpm nx run pipeline:cli -- ingest` works. Extend `run`/`export`/`publish`/`verify`/`sync` branches in later tasks.

- [ ] **Step 13: Run tests** — `pnpm nx run-many -t test lint typecheck -p pipeline` → PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/pipeline
git commit -m "feat(pipeline): duckdb store, incremental ingest with deltas and derived tables"
```

---

### Task 4b: CSLB contractor licenses (best effort, time-boxed to 45 minutes)

**Files:**
- Create: `libs/sources/src/cslb.ts`, `apps/pipeline/src/db/cslb-match.ts`
- Test: `libs/sources/src/cslb.test.ts` (fixture `libs/sources/fixtures/cslb-county-list.csv`, 3 rows), `apps/pipeline/src/db/cslb-match.test.ts`
- Modify: `apps/pipeline/src/commands/ingest.ts` (call after `deriveAll`), `apps/pipeline/src/db/derive.ts` (keep `cslb_*` columns null; matching fills them)

**Interfaces:**
- `fetchCslbCountyList(fetcher, opts: { countyCode: "43"; classification: "C-39"; outDir: string }): Promise<{ path: string; sha256: string; asOf: string | null }>` — GET `https://www2.cslb.ca.gov/onlineservices/dataportal/ListByCounty`, extract `__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`, POST with `ctl00$MainContent$lbClassification=C-39`, `ctl00$MainContent$lbCounty=43`, `ctl00$MainContent$btnSearch=Download`; expect an XLSX; convert to CSV rows with `xlsx` (`pnpm add xlsx`).
- `type CslbLicense = { licenseNumber: string; businessName: string; city: string | null; classifications: string[]; status: string; issueDate: string | null; expirationDate: string | null }`; `parseCslbCsv(path): CslbLicense[]`.
- `matchContractorsToCslb(db: Db, licenses: CslbLicense[], prov: Provenance): Promise<{ matched: number }>` — match on `normalizeCompanyName(businessName) === normalizeCompanyName(company_name)`; on match set `cslb_license_number`, `cslb_status`, `cslb_match_method = 'name'`.

- [ ] **Step 1: Failing tests** — `parseCslbCsv` on the fixture returns 3 licenses with `licenseNumber` kept as text (`"0488238"` keeps its leading zero) and `classifications` split on `|`; `matchContractorsToCslb` links `ECONOMY ROOFING INC` to `0488238` and leaves an unknown company null.
- [ ] **Step 2: Implement** per the interfaces. In `ingest`, wrap the live fetch in try/catch: on failure push `"CSLB Public Data Portal unreachable (HTTP <status>); contractor licenses not matched this run."` to `limitations`, record `sources["cslb-c39"] = { ...ZERO, sourceVersion: "", skipped: false, error }`.
- [ ] **Step 3: Run tests** — PASS. **Commit:** `feat(pipeline): best-effort cslb license matching for contractors`.

---

### Task 5: Export (Parquet, runs.json, coverage.json, SQL examples)

**Files:**
- Create: `apps/pipeline/src/commands/export.ts`, `apps/pipeline/src/sql-examples.ts`
- Modify: `apps/pipeline/src/cli.ts`
- Test: `apps/pipeline/src/commands/export.test.ts`

**Interfaces:**
- Produces: `exportRun(db: Db, opts: { runId: string; outDir: string }): Promise<{ dir: string; files: string[] }>` writing `properties.parquet`, `permits.parquet`, `contractors.parquet`, `owners.parquet`, `roof_age.parquet`, `leads.parquet` (the join view), `runs.json` (all run records, newest first), `coverage.json`, `sql-examples.json`.
- `SQL_EXAMPLES: Array<{ id: string; title: string; sql: string }>` with `{{base}}` placeholder for the gateway directory URL.

- [ ] **Step 1: Failing test**

```ts
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySchema, openDb } from "../db/duck";
import { exportRun } from "./export";

describe("exportRun", () => {
  it("writes parquet per table plus runs, coverage and sql examples", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    await db.run("INSERT INTO runs VALUES ('r1','2026-10-08 00:00:00','2026-10-08 00:01:00','2026-10-08','complete','{\"runId\":\"r1\"}',NULL,NULL)");
    const out = mkdtempSync(join(tmpdir(), "export-"));
    const res = await exportRun(db, { runId: "r1", outDir: out });
    for (const f of ["properties.parquet", "permits.parquet", "contractors.parquet", "owners.parquet", "roof_age.parquet", "leads.parquet", "runs.json", "coverage.json", "sql-examples.json"]) expect(existsSync(join(res.dir, f)), f).toBe(true);
    const coverage = JSON.parse(readFileSync(join(res.dir, "coverage.json"), "utf8"));
    expect(coverage).toMatchObject({ county: "Santa Clara", state: "CA", fips: "06085", runId: "r1", tables: { properties: 0, permits: 0 } });
    await db.close();
  });
});
```

- [ ] **Step 2: Implement**

`apps/pipeline/src/commands/export.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db/duck";
import { SQL_EXAMPLES } from "../sql-examples";

const TABLES = ["properties", "permits", "contractors", "owners", "roof_age"] as const;

const LEADS_SQL = `
  SELECT p.apn, p.situs_address, p.situs_city, p.situs_zip, p.jurisdiction, p.lat, p.lon,
         r.roof_date, r.roof_age_years, r.anchor AS roof_age_anchor, r.confidence AS roof_age_confidence, r.permit_number AS roof_age_permit,
         lp.permit_number, lp.permit_state, lp.days_open, lp.issue_date, lp.final_date, lp.work_description, lp.contractor_company, lp.contractor_id,
         c.cslb_license_number, c.cslb_status, c.bbb_rating,
         o.owner_name, o.observed_on AS owner_observed_on,
         p.source_url AS property_source_url, p.source_version AS property_source_version, p.fetched_at AS property_fetched_at,
         lp.source_url AS permit_source_url, lp.source_version AS permit_source_version
  FROM properties p
  LEFT JOIN roof_age r USING (apn)
  LEFT JOIN (SELECT * FROM permits WHERE is_roofing QUALIFY row_number() OVER (PARTITION BY apn ORDER BY (permit_state='open') DESC, issue_date DESC) = 1) lp USING (apn)
  LEFT JOIN contractors c ON c.contractor_id = lp.contractor_id
  LEFT JOIN (SELECT * FROM owners QUALIFY row_number() OVER (PARTITION BY apn ORDER BY observed_on DESC NULLS LAST) = 1) o USING (apn)
  WHERE r.apn IS NOT NULL OR lp.permit_number IS NOT NULL`;

export async function exportRun(db: Db, opts: { runId: string; outDir: string }) {
  const dir = join(opts.outDir, opts.runId);
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const t of TABLES) {
    await db.run(`COPY (SELECT * FROM ${t}) TO '${join(dir, `${t}.parquet`)}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
    files.push(`${t}.parquet`);
  }
  await db.run(`COPY (${LEADS_SQL}) TO '${join(dir, "leads.parquet")}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  files.push("leads.parquet");

  const runs = await db.all<{ record: string }>("SELECT record FROM runs ORDER BY started_at DESC");
  await writeFile(join(dir, "runs.json"), JSON.stringify(runs.map((r) => JSON.parse(r.record)), null, 2));
  const counts: Record<string, number> = {};
  for (const t of [...TABLES, "runs"]) counts[t] = (await db.all<{ n: number }>(`SELECT count(*)::INT n FROM ${t}`))[0]?.n ?? 0;
  const permitRange = (await db.all<{ min: string | null; max: string | null }>("SELECT min(issue_date)::TEXT AS min, max(issue_date)::TEXT AS max FROM permits"))[0];
  const jurisdictions = await db.all<{ jurisdiction: string; n: number }>("SELECT jurisdiction, count(*)::INT n FROM properties GROUP BY 1 ORDER BY 2 DESC");
  await writeFile(join(dir, "coverage.json"), JSON.stringify({ county: "Santa Clara", state: "CA", fips: "06085", runId: opts.runId, tables: counts, permitIssueDateRange: permitRange, permitJurisdictions: ["SAN JOSE"], parcelJurisdictions: jurisdictions }, null, 2));
  await writeFile(join(dir, "sql-examples.json"), JSON.stringify(SQL_EXAMPLES, null, 2));
  files.push("runs.json", "coverage.json", "sql-examples.json");
  return { dir, files };
}
```

`apps/pipeline/src/sql-examples.ts`:

```ts
export const SQL_EXAMPLES = [
  { id: "aged-roofs-radius", title: "Roofs older than 15 years within 5 miles of downtown San José", sql: `SELECT apn, situs_address, roof_age_years, roof_age_anchor, permit_source_url\nFROM read_parquet('{{base}}/leads.parquet')\nWHERE roof_age_years >= 15\n  AND 2 * 3958.76 * asin(sqrt(pow(sin(radians(lat - 37.3382) / 2), 2) + cos(radians(37.3382)) * cos(radians(lat)) * pow(sin(radians(lon + 121.8863) / 2), 2))) <= 5\nORDER BY roof_age_years DESC LIMIT 50` },
  { id: "long-open-roofing", title: "Open roofing permits, longest open first, with contractor", sql: `SELECT permit_number, apn, situs_address, days_open, contractor_company, cslb_license_number, permit_source_url\nFROM read_parquet('{{base}}/leads.parquet')\nWHERE permit_state = 'open'\nORDER BY days_open DESC LIMIT 50` },
  { id: "owners", title: "Properties by observed owner name", sql: `SELECT apn, owner_name, observed_on, permit_number FROM read_parquet('{{base}}/owners.parquet') WHERE owner_name ILIKE '%LLC%' LIMIT 50` },
  { id: "runs", title: "Run history", sql: `SELECT runId, status, totals FROM read_json('{{base}}/runs.json')` },
];
```

Wire `export` into `cli.ts` (`exportRun(db, { runId: <latest run id from runs table>, outDir: join(process.cwd(), "exports") })`).

- [ ] **Step 3: Run tests** — PASS. **Commit:** `git commit -am "feat(pipeline): export parquet, run history, coverage and sql examples"` (after `git add apps/pipeline`).

---

### Task 6: Publish (CAR, Filebase, manifest)

**Files:**
- Create: `apps/pipeline/src/publish/car.ts`, `apps/pipeline/src/publish/filebase.ts`, `apps/pipeline/src/publish/manifest.ts`, `apps/pipeline/src/commands/publish.ts`
- Modify: `apps/pipeline/src/cli.ts`
- Test: `apps/pipeline/src/publish/car.test.ts`, `apps/pipeline/src/publish/manifest.test.ts`, `apps/pipeline/src/commands/publish.test.ts`

**Interfaces:**
- `packDirectory(dir: string, files: string[]): Promise<{ rootCid: string; entries: Array<{ name: string; cid: string; size: number; sha256: string }>; carPath: string; carSize: number; carSha256: string }>` — CIDv1 base32, UnixFS, raw leaves, 1 MiB chunks, wrapped in a directory. The CAR is written to `<dir>/../<runId>.car`? No: write to `<dir>/snapshot.car` *outside* the DAG (it is created after packing).
- `type Uploader = { putFile(key: string, path: string, meta?: Record<string, string>): Promise<void>; headCid(key: string): Promise<string | null> }`; `filebaseUploader(env: { accessKey; secretKey; bucket }): Uploader` (S3 endpoint `https://s3.filebase.com`, region `us-east-1`; CAR import via metadata `{ import: "car" }`).
- `buildManifest(input: { runId; previousManifestCid: string | null; root: { cid; size; sha256 }; entries; car: { cid: string | null; size; sha256 }; gateways: string[] }): Manifest` where `Manifest = { schema: "scc-manifest/1"; runId; publishedAt; county; fips; previousManifestCid; root: {...codec:"directory"}; artifacts: Array<{ cid; name; size; codec: "file" | "directory"; sha256; path }>; car: {...}; gatewayUrlTemplate: "https://<gateway>/ipfs/<cid>" }`.
- `publish(opts: { db: Db; runId: string; exportDir: string; uploader: Uploader }): Promise<Manifest>` — uploads CAR with import, asserts Filebase's reported CID equals `rootCid` (as CIDv1 string after normalizing a possible CIDv0 via `CID.parse(x).toV1().toString()`), uploads `manifest.json` as a plain object, reads its CID, writes `manifest.json` to the export dir and `docs/runs/<runId>.json`, and updates `runs.manifest_cid`.

- [ ] **Step 1: Failing CAR test (deterministic CID for a fixture)**

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packDirectory } from "./car";

describe("packDirectory", () => {
  it("produces a CIDv1 base32 root, per-file CIDs and a CAR, deterministically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "car-"));
    writeFileSync(join(dir, "a.txt"), "hello");
    writeFileSync(join(dir, "b.json"), "{}");
    const r1 = await packDirectory(dir, ["a.txt", "b.json"]);
    const r2 = await packDirectory(dir, ["a.txt", "b.json"]);
    expect(r1.rootCid).toMatch(/^bafy[a-z2-7]{50,}$/);
    expect(r1.rootCid).toBe(r2.rootCid);
    expect(r1.entries.map((e) => e.name)).toEqual(["a.txt", "b.json"]);
    expect(r1.entries[0]).toMatchObject({ size: 5, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" });
    expect(r1.entries[0]?.cid).toMatch(/^baf[a-z2-7]+$/);
    expect(r1.carSize).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement CAR packing**

```bash
pnpm add ipfs-unixfs-importer @ipld/car blockstore-core multiformats @aws-sdk/client-s3 @aws-sdk/lib-storage
```

`apps/pipeline/src/publish/car.ts`:

```ts
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CarWriter } from "@ipld/car";
import { MemoryBlockstore } from "blockstore-core/memory";
import { importer } from "ipfs-unixfs-importer";
import { CID } from "multiformats/cid";
import { sha256Hex } from "@scc/sources";

export async function packDirectory(dir: string, files: string[]) {
  const blockstore = new MemoryBlockstore();
  const sorted = [...files].sort();
  const source = sorted.map((name) => ({ path: name, content: createReadStream(join(dir, name)) }));
  const entries: Array<{ name: string; cid: string; size: number; sha256: string }> = [];
  let root: CID | null = null;
  for await (const entry of importer(source, blockstore, { cidVersion: 1, rawLeaves: true, chunker: "fixed", maxChunkSize: 1_048_576, wrapWithDirectory: true })) {
    if (entry.path === "" || entry.path === undefined) { root = entry.cid; continue; }
    if (entry.unixfs?.type === "file") {
      const bytes = await readFile(join(dir, entry.path));
      entries.push({ name: entry.path, cid: entry.cid.toString(), size: bytes.length, sha256: sha256Hex(bytes) });
    }
  }
  if (!root) throw new Error("no root produced");
  const carPath = join(dir, "..", `${dir.split("/").pop()}.car`);
  const { writer, out } = CarWriter.create([root]);
  const write = pipeline(Readable.from(out), createWriteStream(carPath));
  for await (const { cid, block } of blockstore.getAll()) await writer.put({ cid, bytes: block });
  await writer.close();
  await write;
  const carBytes = await readFile(carPath);
  return { rootCid: root.toString(), entries, carPath, carSize: (await stat(carPath)).size, carSha256: sha256Hex(carBytes) };
}
```

(`entry.path` for wrapped files is the bare file name; the directory entry has `path === ""`. If the installed importer yields the root with `path === undefined`, the guard above covers it.)

- [ ] **Step 3: Run** — PASS.

- [ ] **Step 4: Failing manifest test**

```ts
import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest";

describe("buildManifest", () => {
  it("lists root, files and car with required fields", () => {
    const m = buildManifest({
      runId: "r1", previousManifestCid: null, publishedAt: "2026-10-08T02:00:00Z",
      root: { cid: "bafyroot", size: 10, sha256: "00" },
      entries: [{ name: "leads.parquet", cid: "bafyleads", size: 5, sha256: "aa" }],
      car: { cid: "bafycar", size: 100, sha256: "cc" },
    });
    expect(m.schema).toBe("scc-manifest/1");
    expect(m.artifacts).toEqual([
      { cid: "bafyroot", name: "snapshot", path: "/", size: 10, codec: "directory", sha256: "00" },
      { cid: "bafyleads", name: "leads.parquet", path: "/leads.parquet", size: 5, codec: "file", sha256: "aa" },
    ]);
    expect(m.car).toEqual({ cid: "bafycar", name: "r1.car", size: 100, codec: "file", sha256: "cc", root: "bafyroot" });
    expect(m.fips).toBe("06085");
  });
});
```

- [ ] **Step 5: Implement manifest + Filebase uploader + publish command**

`apps/pipeline/src/publish/manifest.ts`:

```ts
export type Artifact = { cid: string; name: string; path: string; size: number; codec: "file" | "directory"; sha256: string };
export type Manifest = {
  schema: "scc-manifest/1"; runId: string; publishedAt: string; county: "Santa Clara"; state: "CA"; fips: "06085";
  previousManifestCid: string | null; artifacts: Artifact[]; car: Artifact & { root: string };
  gatewayUrlTemplate: "https://{gateway}/ipfs/{cid}"; ipns: null;
};

export function buildManifest(input: { runId: string; previousManifestCid: string | null; publishedAt: string; root: { cid: string; size: number; sha256: string }; entries: Array<{ name: string; cid: string; size: number; sha256: string }>; car: { cid: string; size: number; sha256: string } }): Manifest {
  return {
    schema: "scc-manifest/1", runId: input.runId, publishedAt: input.publishedAt, county: "Santa Clara", state: "CA", fips: "06085",
    previousManifestCid: input.previousManifestCid,
    artifacts: [
      { cid: input.root.cid, name: "snapshot", path: "/", size: input.root.size, codec: "directory", sha256: input.root.sha256 },
      ...input.entries.map((e) => ({ cid: e.cid, name: e.name, path: `/${e.name}`, size: e.size, codec: "file" as const, sha256: e.sha256 })),
    ],
    car: { cid: input.car.cid, name: `${input.runId}.car`, path: `/${input.runId}.car`, size: input.car.size, codec: "file", sha256: input.car.sha256, root: input.root.cid },
    gatewayUrlTemplate: "https://{gateway}/ipfs/{cid}", ipns: null,
  };
}
```

The root "size" and "sha256" are those of the root block bytes (fetch from the blockstore: `blockstore.get(root)`); extend `packDirectory` to return `rootBlock: { size, sha256 }` and add that to its test (`r1.rootBlock.size > 0`).

`apps/pipeline/src/publish/filebase.ts`:

```ts
import { createReadStream } from "node:fs";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { CID } from "multiformats/cid";

export type Uploader = {
  putFile(key: string, path: string, meta?: Record<string, string>): Promise<void>;
  headCid(key: string): Promise<string | null>;
};

export function filebaseUploader(env: { accessKey: string; secretKey: string; bucket: string }): Uploader {
  const client = new S3Client({ endpoint: "https://s3.filebase.com", region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: env.accessKey, secretAccessKey: env.secretKey } });
  return {
    async putFile(key, path, meta) {
      await new Upload({ client, params: { Bucket: env.bucket, Key: key, Body: createReadStream(path), Metadata: meta } }).done();
    },
    async headCid(key) {
      for (let i = 0; i < 10; i++) {
        const head = await client.send(new HeadObjectCommand({ Bucket: env.bucket, Key: key }));
        const cid = head.Metadata?.cid;
        if (cid) return CID.parse(cid).toV1().toString();
        await new Promise((r) => setTimeout(r, 3000));
      }
      return null;
    },
  };
}
```

`apps/pipeline/src/commands/publish.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db/duck";
import { packDirectory } from "../publish/car";
import type { Uploader } from "../publish/filebase";
import { buildManifest, type Manifest } from "../publish/manifest";
import { sha256Hex } from "@scc/sources";

export async function publish(opts: { db: Db; runId: string; exportDir: string; uploader: Uploader; docsRunsDir: string; now: string }): Promise<Manifest> {
  const { db, runId, uploader } = opts;
  const dir = join(opts.exportDir, runId);
  const files = ["properties.parquet", "permits.parquet", "contractors.parquet", "owners.parquet", "roof_age.parquet", "leads.parquet", "runs.json", "coverage.json", "sql-examples.json"];
  const packed = await packDirectory(dir, files);

  await uploader.putFile(`${runId}/${runId}.car`, packed.carPath, { import: "car" });
  const reported = await uploader.headCid(`${runId}/${runId}.car`);
  if (reported !== packed.rootCid) throw new Error(`pinning service reported ${reported}, expected ${packed.rootCid}`);

  // the CAR file itself as a plain object so it is fetchable by its own CID
  await uploader.putFile(`${runId}/car/${runId}.car`, packed.carPath);
  const carCid = await uploader.headCid(`${runId}/car/${runId}.car`);
  if (!carCid) throw new Error("CAR object CID not reported");

  const prev = (await db.all<{ manifest_cid: string | null }>("SELECT manifest_cid FROM runs WHERE manifest_cid IS NOT NULL ORDER BY started_at DESC LIMIT 1"))[0];
  const manifest = buildManifest({ runId, previousManifestCid: prev?.manifest_cid ?? null, publishedAt: opts.now, root: { cid: packed.rootCid, ...packed.rootBlock }, entries: packed.entries, car: { cid: carCid, size: packed.carSize, sha256: packed.carSha256 } });
  const manifestPath = join(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await uploader.putFile(`${runId}/manifest.json`, manifestPath);
  const manifestCid = await uploader.headCid(`${runId}/manifest.json`);
  if (!manifestCid) throw new Error("manifest CID not reported");

  await db.run("UPDATE runs SET manifest_cid = ? WHERE run_id = ?", [manifestCid, runId]);
  await mkdir(opts.docsRunsDir, { recursive: true });
  const runRecord = JSON.parse((await db.all<{ record: string }>("SELECT record FROM runs WHERE run_id = ?", [runId]))[0]?.record ?? "{}");
  await writeFile(join(opts.docsRunsDir, `${runId}.json`), JSON.stringify({ ...runRecord, manifestCid, manifest, manifestSha256: sha256Hex(await readFile(manifestPath)) }, null, 2));
  return manifest;
}
```

Test `publish.test.ts` with a fake `Uploader` that records `putFile` calls and returns the CID the test derives by packing the same dir (call `packDirectory` in the test to learn the expected root) — assert the CAR is uploaded with `{ import: "car" }`, the mismatch case throws, `runs.manifest_cid` is set, and `docs/runs/<runId>.json` exists.

Wire `publish` into `cli.ts` using `filebaseUploader` from env (`FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET`), `docsRunsDir = join(process.cwd(), "docs/runs")`.

- [ ] **Step 6: Run tests, lint, typecheck** — PASS. **Commit:** `feat(pipeline): publish snapshot as CAR to filebase with cidv1 manifest`.

---

### Task 7: Verify via independent public gateways

**Files:**
- Create: `apps/pipeline/src/commands/verify.ts`, `apps/pipeline/src/publish/gateways.ts`
- Modify: `apps/pipeline/src/cli.ts`
- Test: `apps/pipeline/src/commands/verify.test.ts`

**Interfaces:**
- `PUBLIC_GATEWAYS = ["dweb.link", "ipfs.io", "gateway.pinata.cloud", "w3s.link", "ipfs.4everland.io", "trustless-gateway.link", "flk-ipfs.xyz"]`; `VENDOR_GATEWAYS = ["ipfs.filebase.io"]`.
- `verifyManifest(manifest: Manifest, fetcher: Fetcher, opts: { gateways?: string[]; minIndependent?: number; retries?: number; timeoutMs?: number }): Promise<VerificationReport>` with `VerificationReport = { runId; verifiedAt; ok: boolean; artifacts: Array<{ cid; name; results: Array<{ gateway; status: number | "error"; bytes: number; sha256Match: boolean; ms: number }>; independentOk: number }> }`.
- Directory root is verified with `?format=car` on the gateway (`Accept: application/vnd.ipld.car`), checking HTTP 200 and that the CAR's root equals the CID; files are byte-compared (size + sha256).

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { verifyManifest } from "./verify";

const manifest = { schema: "scc-manifest/1", runId: "r1", artifacts: [{ cid: "bafyfile", name: "a.txt", path: "/a.txt", size: 5, codec: "file", sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" }], car: { cid: "bafycar", name: "r1.car", path: "/r1.car", size: 5, codec: "file", sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", root: "bafyfile" } } as never;

describe("verifyManifest", () => {
  it("passes when two independent gateways return matching bytes", async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes("ipfs.filebase.io") ? new Response("hello") : url.includes("dweb.link") || url.includes("ipfs.io") ? new Response("hello") : new Response("nope", { status: 429 })));
    const report = await verifyManifest(manifest, fetcher, { gateways: ["ipfs.filebase.io", "dweb.link", "ipfs.io", "w3s.link"], retries: 0 });
    expect(report.ok).toBe(true);
    expect(report.artifacts[0]?.independentOk).toBe(2);
  });
  it("fails when only the vendor gateway and one other succeed", async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes("ipfs.filebase.io") || url.includes("dweb.link") ? new Response("hello") : new Response("nope", { status: 429 })));
    const report = await verifyManifest(manifest, fetcher, { gateways: ["ipfs.filebase.io", "dweb.link", "ipfs.io"], retries: 0 });
    expect(report.ok).toBe(false);
    expect(report.artifacts[0]?.independentOk).toBe(1);
  });
  it("fails on digest mismatch", async () => {
    const fetcher = vi.fn(async () => new Response("hellx"));
    const report = await verifyManifest(manifest, fetcher, { gateways: ["dweb.link", "ipfs.io"], retries: 0 });
    expect(report.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

`apps/pipeline/src/publish/gateways.ts` exports the two lists above. `apps/pipeline/src/commands/verify.ts`:

```ts
import { sha256Hex, type Fetcher } from "@scc/sources";
import { PUBLIC_GATEWAYS, VENDOR_GATEWAYS } from "../publish/gateways";
import type { Manifest } from "../publish/manifest";

export type GatewayResult = { gateway: string; status: number | "error"; bytes: number; sha256Match: boolean; ms: number; error?: string };
export type VerificationReport = { runId: string; verifiedAt: string; ok: boolean; minIndependent: number; artifacts: Array<{ cid: string; name: string; codec: string; results: GatewayResult[]; independentOk: number }> };

export async function verifyManifest(manifest: Manifest, fetcher: Fetcher, opts: { gateways?: string[]; minIndependent?: number; retries?: number; timeoutMs?: number } = {}): Promise<VerificationReport> {
  const gateways = opts.gateways ?? [...PUBLIC_GATEWAYS, ...VENDOR_GATEWAYS];
  const minIndependent = opts.minIndependent ?? 2;
  const items = [...manifest.artifacts, manifest.car];
  const artifacts = [];
  for (const a of items) {
    const results: GatewayResult[] = [];
    for (const gw of gateways) {
      results.push(await fetchOne(fetcher, gw, a, opts));
    }
    const independentOk = results.filter((r) => r.sha256Match && !VENDOR_GATEWAYS.includes(r.gateway)).length;
    artifacts.push({ cid: a.cid, name: a.name, codec: a.codec, results, independentOk });
  }
  return { runId: manifest.runId, verifiedAt: new Date().toISOString(), ok: artifacts.every((a) => a.independentOk >= minIndependent), minIndependent, artifacts };
}

async function fetchOne(fetcher: Fetcher, gateway: string, a: { cid: string; codec: string; size: number; sha256: string }, opts: { retries?: number; timeoutMs?: number }): Promise<GatewayResult> {
  const isDir = a.codec === "directory";
  const url = `https://${gateway}/ipfs/${a.cid}${isDir ? "?format=car" : ""}`;
  const t0 = Date.now();
  for (let attempt = 0; attempt <= (opts.retries ?? 2); attempt++) {
    try {
      const res = await fetcher(url, { headers: isDir ? { accept: "application/vnd.ipld.car" } : {}, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (isDir) return { gateway, status: res.status, bytes: bytes.length, sha256Match: res.ok && bytes.length > 0 && carRootMatches(bytes, a.cid), ms: Date.now() - t0 };
      return { gateway, status: res.status, bytes: bytes.length, sha256Match: res.ok && bytes.length === a.size && sha256Hex(bytes) === a.sha256, ms: Date.now() - t0 };
    } catch (err) {
      if (attempt === (opts.retries ?? 2)) return { gateway, status: "error", bytes: 0, sha256Match: false, ms: Date.now() - t0, error: String(err) };
    }
  }
  return { gateway, status: 429, bytes: 0, sha256Match: false, ms: Date.now() - t0 };
}

function carRootMatches(bytes: Uint8Array, cid: string): boolean {
  // CAR v1 header: varint length + dag-cbor {version:1, roots:[cid]}; the root CID bytes appear verbatim.
  const { CID } = require("multiformats/cid") as typeof import("multiformats/cid");
  const want = CID.parse(cid).bytes;
  const head = bytes.subarray(0, Math.min(bytes.length, 256));
  return head.toString().includes(want.toString());
}
```

(Replace `require` with a static import; the `toString()` comparison on `Uint8Array` is a placeholder for an `indexOf` on bytes — implement a small `includesBytes(haystack, needle)` helper and unit-test it with a CAR produced by Task 6's `packDirectory`.)

Wire `verify` into `cli.ts`: read `exports/<runId>/manifest.json`, run `verifyManifest(manifest, fetch)`, write `exports/<runId>/verification.json` and merge `verification` into `docs/runs/<runId>.json`; exit code 1 when `ok === false`.

- [ ] **Step 3: Run tests** — PASS. **Commit:** `feat(pipeline): verify published cids on independent public gateways`.

---

### Task 8: Sync snapshot to Cloudflare D1

**Files:**
- Create: `apps/pipeline/src/commands/sync.ts`, `apps/pipeline/src/sync/sql.ts`, `apps/mcp-server/migrations/0001_snapshot.sql`
- Modify: `apps/pipeline/src/cli.ts`
- Test: `apps/pipeline/src/sync/sql.test.ts`

**Interfaces:**
- `buildD1Statements(db: Db, opts: { manifestCid: string; runId: string; batchSize?: number }): AsyncGenerator<string>` yields SQL chunks: first `DELETE FROM ...` for all snapshot tables, then batched `INSERT INTO properties (...) VALUES (...),(...)` (500 rows per statement, 50 statements per file), finally `INSERT INTO snapshot (id, run_id, manifest_cid, synced_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ...`.
- `sync(opts: { db: Db; runId: string; manifestCid: string; outDir: string; exec: (file: string) => Promise<void> })` writes `sync/<n>.sql` files and calls `exec` for each; CLI `exec` runs `wrangler d1 execute scc-snapshot --remote --file <file>` with `cwd = apps/mcp-server`.

D1 schema (`0001_snapshot.sql`): same columns as DuckDB for `properties` (apn, situs_address, situs_city, situs_zip, jurisdiction, lat REAL, lon REAL, source_url, source_version, fetched_at), `permits` (all columns except page_sha256/record_hash), `contractors`, `owners`, `roof_age`, plus `snapshot(id INTEGER PRIMARY KEY, run_id TEXT, manifest_cid TEXT, synced_at TEXT)` and `runs(run_id TEXT PRIMARY KEY, record TEXT)`, indexes `idx_properties_lat_lon ON properties(lat, lon)`, `idx_permits_apn`, `idx_roof_age_years ON roof_age(roof_age_years)`, `idx_permits_state ON permits(permit_state, is_roofing)`.

- [ ] **Step 1: Failing test** — `buildD1Statements` over an in-memory DuckDB with 3 properties and batchSize 2 yields: 1 delete chunk, 2 insert chunks for properties (2 rows, 1 row), insert chunks for other tables (empty tables yield none), and 1 snapshot chunk; values are SQL-escaped (`O'BRIEN` → `O''BRIEN`), `NULL` for nulls, booleans as 0/1.

- [ ] **Step 2: Implement** `sql.ts` with `sqlLiteral(v: unknown): string` (`null`→`NULL`, boolean→`1/0`, number→`String`, string→quoted with `''` escaping, date/timestamp strings as-is quoted) and the generator; `sync.ts` writes files and calls `exec` sequentially, logging progress. For 504k properties at 500 rows/statement and 50 statements/file this is ~21 files for properties; D1 import handles them in a few minutes.

- [ ] **Step 3: Run tests** — PASS. **Commit:** `feat(pipeline): sync published snapshot into cloudflare d1`.

---

### Task 9: MCP + REST Worker (`apps/mcp-server`)

**Files:**
- Create: `apps/mcp-server/wrangler.jsonc`, `apps/mcp-server/src/index.ts`, `apps/mcp-server/src/queries.ts`, `apps/mcp-server/src/tools.ts`, `apps/mcp-server/src/schemas.ts`, `apps/mcp-server/project.json`, `apps/mcp-server/tsconfig.json`, `apps/mcp-server/vitest.config.ts`
- Test: `apps/mcp-server/src/queries.test.ts`, `apps/mcp-server/src/index.test.ts`

**Interfaces (REST, also 1:1 MCP tools):**
- `GET /api/health` → `{ ok: true, snapshot: { runId, manifestCid, syncedAt } }`
- `GET /api/properties/radius?lat&lon&radiusMiles&limit` → `{ snapshot, items: Property[] (with distanceMiles) }`
- `GET /api/leads/aged-roofs?lat&lon&radiusMiles&minRoofAgeYears=15&limit` → `{ snapshot, items: Lead[] }`
- `GET /api/leads/open-permits?lat&lon&radiusMiles&state=open|expired_unfinaled|any&minOpenYears=0&roofingOnly=true&limit` → `{ snapshot, items: Lead[] }` sorted by `days_open DESC`
- `GET /api/properties/:apn` → `{ snapshot, property, permits[], roofAge, owners[], contractors[] }`
- `GET /api/contractors/:id` → contractor + its permits
- `GET /api/runs` → `RunRecord[]` ; `GET /api/manifest` → latest manifest (from `runs` record)
- `POST /mcp` — MCP Streamable HTTP (`@hono/mcp` `StreamableHTTPTransport`, stateless) exposing tools `search_properties_in_radius`, `find_aged_roofs`, `find_open_roofing_permits`, `get_property`, `get_contractor`, `list_runs`, `get_manifest` with Zod input schemas from `schemas.ts` (shared with REST validation).
- `Lead` = row of a SQL join equivalent to the DuckDB `leads` view, plus `distanceMiles`, plus `provenance: { propertySourceUrl, propertySourceVersion, permitSourceUrl, permitSourceVersion, fetchedAt }`.

- [ ] **Step 1: Scaffold worker**

```bash
pnpm add hono @hono/mcp @modelcontextprotocol/sdk zod
pnpm add -D wrangler @cloudflare/workers-types @cloudflare/vitest-pool-workers
```

`apps/mcp-server/wrangler.jsonc`:

```jsonc
{
  "name": "scc-pipeline-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [{ "binding": "DB", "database_name": "scc-snapshot", "database_id": "<filled after `wrangler d1 create scc-snapshot`>" }],
  "observability": { "enabled": true }
}
```

`project.json` targets: `typecheck` (`tsc --noEmit -p apps/mcp-server/tsconfig.json`), `test` (vitest with the workers pool), `deploy` (`wrangler deploy`), `migrate` (`wrangler d1 migrations apply scc-snapshot --remote`).

- [ ] **Step 2: Failing query tests (workers pool with local D1 + applied migration)**

`queries.test.ts` seeds 3 properties (two within 1 mile of a center, one 20 miles away), 2 permits (one open roofing 3 years old, one finaled), 1 roof_age row (20 years) and asserts: `radius` returns 2 sorted by distance; `agedRoofs(min 15)` returns 1 with `roofAgeYears 20`; `openPermits(state open, minOpenYears 2)` returns 1 with `daysOpen >= 730`; `property(apn)` composes the detail; every lead carries `provenance.permitSourceUrl`.

- [ ] **Step 3: Implement `queries.ts`**

Radius pattern for every spatial query:

```ts
const box = boundingBox(center, radiusMiles);
const rows = await db.prepare(`${SELECT} WHERE p.lat BETWEEN ?1 AND ?2 AND p.lon BETWEEN ?3 AND ?4 ${extraWhere} LIMIT ?5`).bind(box.minLat, box.maxLat, box.minLon, box.maxLon, limit * 4).all();
return rows.results.map(withDistance).filter((r) => r.distanceMiles <= radiusMiles).sort(sorter).slice(0, limit);
```

`@scc/domain` is imported for `boundingBox`/`haversineMiles` (pure, bundles fine). `LEADS_SELECT` is the SQLite translation of the DuckDB `leads` join (use correlated subqueries for "latest roofing permit per apn" and "latest owner per apn" since SQLite lacks `QUALIFY`).

- [ ] **Step 4: Implement `index.ts` (Hono app + MCP)**

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools";
import * as q from "./queries";
import { RadiusQuery, AgedRoofsQuery, OpenPermitsQuery } from "./schemas";

type Env = { DB: D1Database };
const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

app.get("/api/health", async (c) => c.json({ ok: true, snapshot: await q.snapshot(c.env.DB) }));
app.get("/api/properties/radius", async (c) => { const p = RadiusQuery.parse(c.req.query()); return c.json({ snapshot: await q.snapshot(c.env.DB), items: await q.radius(c.env.DB, p) }); });
app.get("/api/leads/aged-roofs", async (c) => { const p = AgedRoofsQuery.parse(c.req.query()); return c.json({ snapshot: await q.snapshot(c.env.DB), items: await q.agedRoofs(c.env.DB, p) }); });
app.get("/api/leads/open-permits", async (c) => { const p = OpenPermitsQuery.parse(c.req.query()); return c.json({ snapshot: await q.snapshot(c.env.DB), items: await q.openPermits(c.env.DB, p) }); });
app.get("/api/properties/:apn", async (c) => { const r = await q.property(c.env.DB, c.req.param("apn")); return r ? c.json(r) : c.json({ error: "not found" }, 404); });
app.get("/api/contractors/:id", async (c) => { const r = await q.contractor(c.env.DB, c.req.param("id")); return r ? c.json(r) : c.json({ error: "not found" }, 404); });
app.get("/api/runs", async (c) => c.json(await q.runs(c.env.DB)));
app.get("/api/manifest", async (c) => c.json(await q.manifest(c.env.DB)));

app.all("/mcp", async (c) => {
  const server = new McpServer({ name: "santa-clara-property-intelligence", version: "0.1.0" });
  registerTools(server, c.env.DB);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

app.onError((err, c) => c.json({ error: err.message }, err.name === "ZodError" ? 400 : 500));
export default app;
```

`tools.ts` registers each tool with `server.registerTool(name, { description, inputSchema: Schema.shape }, async (args) => ({ content: [{ type: "text", text: JSON.stringify(result) }] }))` calling the same `queries` functions. Tool descriptions state units (miles, years) and that results include provenance.

- [ ] **Step 5: `index.test.ts`** — with the workers pool: `GET /api/health` 200; `GET /api/leads/aged-roofs?lat=37.33&lon=-121.88&radiusMiles=5` 200 with `items` array; `POST /mcp` with a JSON-RPC `tools/list` returns the 7 tool names; `GET /api/properties/radius?lat=abc` → 400.

- [ ] **Step 6: Run tests, lint, typecheck** — PASS. **Commit:** `feat(mcp-server): hono worker with rest and mcp tools over d1 snapshot`.

---

### Task 10: Explorer (React + MUI + DuckDB-WASM)

**Files:**
- Create via generator: `pnpm nx g @nx/react:app apps/explorer --bundler=vite --style=css --routing=true --unitTestRunner=vitest --e2eTestRunner=none --no-interactive`
- Create: `apps/explorer/src/api.ts`, `apps/explorer/src/pages/RunsPage.tsx`, `apps/explorer/src/pages/SourcesPage.tsx`, `apps/explorer/src/pages/ManifestPage.tsx`, `apps/explorer/src/pages/SqlPage.tsx`, `apps/explorer/src/duckdb.ts`, `apps/explorer/src/App.tsx`, `apps/explorer/.env.example` (`VITE_API_BASE`, `VITE_GATEWAY=https://ipfs.filebase.io`)
- Test: `apps/explorer/src/pages/RunsPage.test.tsx`, `apps/explorer/src/duckdb.test.ts` (query building only)

**Interfaces:**
- Consumes REST from Task 9. `api.ts`: `getRuns()`, `getManifest()`, `getHealth()`.
- `duckdb.ts`: `initDuckDb(): Promise<AsyncDuckDB>` (jsdelivr bundles via `getJsDelivrBundles()`), `runSql(sql: string): Promise<{ columns: string[]; rows: unknown[][] }>`, `resolveSql(template: string, base: string): string` replacing `{{base}}` with `<gateway>/ipfs/<rootCid>`.

Pages:
1. **Runs** (`/`): table of runs (run id, started, status, totals, manifest CID), expandable per-source deltas and limitations; chips "complete / partial". Shows the current snapshot banner from `/api/health`.
2. **Sources** (`/sources`): the source catalog (static table from `docs/sources.md` data: key, URL, refresh signal, constraints) merged with the latest run's per-source versions and counts.
3. **Manifest** (`/manifest`): artifact table (name, codec, size, sha256, CID) with links to `dweb.link`, `ipfs.io`, `gateway.pinata.cloud` derived from CID; CAR row; `verification.json` results (gateway × artifact matrix, green/red); "previous manifest" link chain.
4. **SQL** (`/sql`): DuckDB-WASM panel; example picker from `sql-examples.json`; editor (MUI `TextField` multiline); "Run" button; results grid; status line "DuckDB-WASM in your browser reading `<gateway>/ipfs/<rootCid>/leads.parquet` — no server database".

- [ ] **Step 1: Generate app, add MUI + router + DuckDB-WASM**

```bash
pnpm add @mui/material @emotion/react @emotion/styled @mui/icons-material react-router-dom @duckdb/duckdb-wasm apache-arrow
```

- [ ] **Step 2: Failing test** for `resolveSql` and `RunsPage` render with a mocked `getRuns` returning one run (asserts run id and totals text appear). Use `@testing-library/react`.

- [ ] **Step 3: Implement** pages per the list above; `duckdb.ts`:

```ts
import * as duckdb from "@duckdb/duckdb-wasm";
let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
export function initDuckDb() {
  dbPromise ??= (async () => {
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const worker = new Worker(URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })));
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return db;
  })();
  return dbPromise;
}
export function resolveSql(template: string, base: string) { return template.replaceAll("{{base}}", base); }
export async function runSql(sql: string) {
  const db = await initDuckDb();
  const conn = await db.connect();
  try {
    const table = await conn.query(sql);
    return { columns: table.schema.fields.map((f) => f.name), rows: table.toArray().map((r) => Object.values(r.toJSON())) };
  } finally { await conn.close(); }
}
```

- [ ] **Step 4: Build and run tests** — `pnpm nx run-many -t test lint typecheck build -p explorer` → PASS. **Commit:** `feat(explorer): runs, sources, manifest and duckdb-wasm sql pages`.

---

### Task 11: Scheduled ingestion workflow, docs, README section

**Files:**
- Create: `.github/workflows/ingest.yml`, `docs/sources.md`, `docs/limitations.md`, `docs/demo-script.md`
- Modify: `README.md` (append section "Candidate implementation" with: live URLs, how it works, how to reproduce, where the CIDs are)

- [ ] **Step 1: `ingest.yml`**

```yaml
name: ingest
on:
  schedule: [{ cron: "30 0 * * *" }]   # 00:30 UTC = 17:30 PT, after San José's 16:00 refresh
  workflow_dispatch:
jobs:
  run:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Restore DuckDB state
        uses: actions/cache@v4
        with: { path: data/santa-clara.duckdb, key: duckdb-${{ github.run_id }}, restore-keys: duckdb- }
      - run: pnpm nx run pipeline:cli -- run
        env:
          FILEBASE_ACCESS_KEY: ${{ secrets.FILEBASE_ACCESS_KEY }}
          FILEBASE_SECRET_KEY: ${{ secrets.FILEBASE_SECRET_KEY }}
          FILEBASE_BUCKET: ${{ secrets.FILEBASE_BUCKET }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Commit run record
        run: |
          git config user.name "scc-pipeline-bot"
          git config user.email "pipeline@users.noreply.github.com"
          git add docs/runs
          git commit -m "chore(runs): record pipeline run" || echo "nothing to commit"
          git push
```

- [ ] **Step 2: `docs/sources.md`** — one table row per source (key, owner, URL, format, refresh, size, constraints observed: Socrata 50k page cap, CKAN daily 16:00 PT, San José ArcGIS 522 from EU and Cloudflare egress, CSLB 503/timeouts, BBB no bulk, Assessor paid $495, SOS BizFile behind Incapsula), plus the list of the 15 uncovered jurisdictions with their portal vendors (copied from the competitor's research with attribution "catalogued from public portal inspection").

- [ ] **Step 3: `docs/limitations.md`** — what each acceptance criterion cannot fully get from free sources and why, mirroring the `STATIC_LIMITATIONS` strings.

- [ ] **Step 4: `docs/demo-script.md`** — the README demo transcript rewritten as click-by-click steps against the live URLs, with the exact MCP call to show (`curl -X POST $API/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_aged_roofs","arguments":{"lat":37.3382,"lon":-121.8863,"radiusMiles":5,"minRoofAgeYears":15}}}'`).

- [ ] **Step 5: Commit** — `docs: source catalog, limitations, demo script and scheduled ingest workflow`.

---

### Task 12: First real run, deploy, second run

This task is operational; every step records its evidence in `docs/runs/`.

- [ ] **Step 1: Create D1 and deploy the Worker**

```bash
cd apps/mcp-server
npx wrangler d1 create scc-snapshot            # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply scc-snapshot --remote
npx wrangler deploy                            # note the URL https://scc-pipeline-api.mikhalenia-a.workers.dev
curl https://scc-pipeline-api.mikhalenia-a.workers.dev/api/health
```

- [ ] **Step 2: Run 1 (full)**

```bash
nvm use && pnpm nx run pipeline:cli -- ingest     # expect ~504k properties, ~100k permits, ~9k roofing
pnpm nx run pipeline:cli -- export
pnpm nx run pipeline:cli -- publish               # prints root CID, manifest CID
pnpm nx run pipeline:cli -- verify                # expect ok=true, else adjust gateway list and re-run
pnpm nx run pipeline:cli -- sync
curl "$API/api/leads/aged-roofs?lat=37.3382&lon=-121.8863&radiusMiles=5" | head -c 600
git add docs/runs && git commit -m "chore(runs): record first full run"
```

- [ ] **Step 3: Deploy Explorer**

```bash
pnpm nx build explorer   # with VITE_API_BASE=https://scc-pipeline-api.mikhalenia-a.workers.dev
npx wrangler pages project create scc-explorer --production-branch main
npx wrangler pages deploy apps/explorer/dist --project-name scc-explorer
```

Open the URL; check Runs, Manifest (gateway links resolve), SQL (example 2 returns rows).

- [ ] **Step 4: Run 2 (incremental, next calendar day or after the 16:00 PT refresh)**

Same commands as Run 1. Expect: parcels `skipped: true` (same `:updated_at`), permits deltas > 0, new manifest CID, `previousManifestCid` set, both CIDs in `docs/runs`. Verify the Run-1 root CID still resolves on a public gateway and paste that check into `docs/runs/<run2>.json` under `previousStillResolves`.

If the San José files have not changed between the two runs (same `last_modified`), run 2 is still a legitimate recorded run with all sources `skipped` and a published manifest whose `artifacts` CIDs equal run 1 (content-addressed) and whose `manifest.json` CID differs (new `runId`, `publishedAt`, `previousManifestCid`). State this in the run record.

- [ ] **Step 5: Commit** — `chore(runs): record incremental run`.

---

### Task 13: Self-assessment, acceptance-criteria traceability, YAGNI pass, PR text

- [ ] **Step 1: `docs/acceptance-criteria.md`** — a table with every bullet of the assignment README's Acceptance Criteria and Demo Transcript: status `met` / `partial` / `gap`, evidence (URL, file, CID, run id).
- [ ] **Step 2: YAGNI pass** — delete unused exports, options and files; `pnpm check` green.
- [ ] **Step 3: `docs/slowking-self-assessment.md`** — run the kit's Slowking procedure (intent, gates, scorecard, functional breakdown) against the live runtime; record the score.
- [ ] **Step 4: `docs/pr-description.md`** — the PR body: live URLs, demo video placeholder, how to review in 2 minutes, dataset numbers, CIDs, limitations, deviation from Golden Path (Cloudflare instead of AWS/CDK: zero idle cost), acceptance-criteria link.
- [ ] **Step 5: Commit** — `docs: acceptance traceability, self-assessment and pr description`.
