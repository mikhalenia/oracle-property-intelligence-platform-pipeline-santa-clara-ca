import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applySchema, openDb, type Db } from "../db/duck";
import { buildD1Statements, D1_COLUMNS, sqlLiteral } from "./sql";

const migration = readFileSync(
  new URL("../../../mcp-server/migrations/0001_snapshot.sql", import.meta.url),
  "utf8",
);

async function seed(): Promise<Db> {
  const db = await openDb(":memory:");
  await applySchema(db);
  const src = "'k','http://x','v1','2026-10-01 00:00:00'";
  await db.run(
    `INSERT INTO properties VALUES
     ('A1','1 MAIN ST','SAN JOSE','95112','SJ','tra',37.1,-121.2,${src},'h','h','r1','r1','r1'),
     ('A2','2 O''BRIEN ST','SAN JOSE',NULL,'SJ','tra',37.2,-121.3,${src},'h','h','r1','r1','r1'),
     ('A3','3 ELM','PALO ALTO','94301','PA','tra',37.4,-122.1,${src},'h','h','r1','r1','r1')`,
  );
  await db.run(
    `INSERT INTO permits VALUES ('P1','A1','Final','done',true,'reroof',NULL,NULL,NULL,'2020-05-01',NULL,NULL,1500.5,'1 MAIN ST','app','own',NULL,'ACME',NULL,'c1',NULL,${src},'h','h','r1','r1','r1')`,
  );
  await db.run(`INSERT INTO contractors VALUES ('c1','ACME',NULL,3,1,NULL,NULL,NULL,NULL,${src})`);
  await db.run(`INSERT INTO owners VALUES ('A1','JOE','2020-05-01','P1',${src})`);
  await db.run(`INSERT INTO roof_age VALUES ('A1','2020-05-01',6,'issue','high','P1',${src})`);
  await db.run(
    `INSERT INTO runs VALUES ('r0','2026-09-01 00:00:00',NULL,'2026-09-01','complete','{"runId":"r0"}',NULL,NULL),
     ('r1','2026-10-01 00:00:00',NULL,'2026-10-01','complete','{"runId":"r1"}','bafyRunCID',NULL)`,
  );
  return db;
}

async function collect(db: Db): Promise<string[]> {
  const out: string[] = [];
  for await (const c of buildD1Statements(db, {
    manifestCid: "bafyCID",
    runId: "r1",
    batchSize: 2,
    statementsPerFile: 1,
  }))
    out.push(c);
  return out;
}

describe("sqlLiteral", () => {
  it("renders values", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
    expect(sqlLiteral(true)).toBe("1");
    expect(sqlLiteral(false)).toBe("0");
    expect(sqlLiteral(1.5)).toBe("1.5");
    expect(sqlLiteral(Number.NaN)).toBe("NULL");
    expect(sqlLiteral(Infinity)).toBe("NULL");
    expect(sqlLiteral("O'B")).toBe("'O''B'");
  });
});

describe("buildD1Statements", () => {
  it("yields delete, batched inserts and snapshot upsert", async () => {
    const db = await seed();
    const chunks = await collect(db);
    await db.close();
    expect(chunks[0]).toMatch(/^DELETE FROM properties;/);
    for (const t of ["properties", "permits", "contractors", "owners", "roof_age", "runs"])
      expect(chunks[0]).toContain(`DELETE FROM ${t};`);
    const props = chunks.filter((c) => c.startsWith("INSERT INTO properties "));
    expect(props).toHaveLength(2);
    expect(props[0]!.match(/\('A\d'/g)).toHaveLength(2);
    expect(props[1]!.match(/\('A\d'/g)).toHaveLength(1);
    expect(props[0]).toContain("O''BRIEN");
    expect(props[0]).toMatch(/'SAN JOSE', NULL, 'SJ'/);
    const permit = chunks.find((c) => c.startsWith("INSERT INTO permits "))!;
    expect(permit).toContain("'P1', 'A1', 'Final', 'done', 1,");
    expect(permit).toContain("'2020-05-01', NULL,");
    const runs = chunks.filter((c) => c.startsWith("INSERT INTO runs "));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain('"manifestCid":"bafyRunCID"');
    expect(runs[0]).toMatch(/'r0', '\{[^']*"manifestCid":null/);
    const last = chunks[chunks.length - 1]!;
    expect(last).toContain(
      "INSERT INTO snapshot (id, run_id, manifest_cid, synced_at) VALUES (1, 'r1', 'bafyCID', '",
    );
    expect(last).toContain("ON CONFLICT(id) DO UPDATE SET");
    expect(chunks).toHaveLength(1 + 2 + 5 + 1);
  });

  it("emits no insert chunk for empty tables", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const chunks = await collect(db);
    await db.close();
    expect(chunks).toHaveLength(2);
    expect(chunks.some((c) => c.startsWith("INSERT INTO properties"))).toBe(false);
  });

  it("keeps column lists in sync with the migration", () => {
    for (const [table, cols] of Object.entries(D1_COLUMNS)) {
      const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(
        migration,
      );
      expect(m, table).not.toBeNull();
      const body = m![1]!
        .split(",")
        .map((s) => s.trim().split(/\s+/)[0]!)
        .filter((n) => /^[a-z_]+$/.test(n) && n !== "PRIMARY");
      expect(
        body.filter((n) => cols.includes(n)),
        table,
      ).toEqual([...cols]);
    }
  });

  it("cuts insert statements by size and never drops oversized rows", async () => {
    const db = await openDb(":memory:");
    await applySchema(db);
    const src = "'k','http://x','v1','2026-10-01 00:00:00'";
    const big = "x".repeat(3000);
    for (let i = 0; i < 7; i++)
      await db.run(
        `INSERT INTO properties VALUES ('B${i}','${big}','C','1','J','t',1,2,${src},'h','h','r','r','r')`,
      );
    await db.run(
      `INSERT INTO properties VALUES ('B9','${"y".repeat(9000)}','C','1','J','t',1,2,${src},'h','h','r','r','r')`,
    );
    const stmts: string[] = [];
    const order: string[] = [];
    for await (const c of buildD1Statements(db, {
      manifestCid: "c",
      runId: "r1",
      maxStatementBytes: 8_000,
    })) {
      order.push(c.slice(0, 20));
      for (const st of c.split(/;\n/).filter((x) => x.startsWith("INSERT INTO properties ")))
        stmts.push(st);
    }
    await db.close();
    expect(order[0]).toMatch(/^DELETE FROM/);
    expect(order[order.length - 1]).toMatch(/^INSERT INTO snapshot/);
    const rows = stmts.map((st) => st.match(/\('B\d'/g)!.length);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(8);
    for (const st of stmts) {
      const n = st.match(/\('B\d'/g)!.length;
      if (n > 1) expect(st.length).toBeLessThanOrEqual(8_000);
    }
    expect(stmts.some((st) => st.length > 8_000 && st.match(/\('B\d'/g)!.length === 1)).toBe(true);
    expect(Math.max(...rows)).toBe(2);
  });
});
