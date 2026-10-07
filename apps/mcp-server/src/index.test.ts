import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { CENTER, seed } from "./test/seed";

const BASE = "http://worker.test";
const get = (path: string) => exports.default.fetch(`${BASE}${path}`);

beforeAll(async () => {
  await seed(env.DB);
});

/** Posts a JSON-RPC message to /mcp and returns the parsed JSON-RPC response (JSON or SSE). */
async function mcp(body: unknown): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const res = await exports.default.fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(data!.slice("data: ".length)) as never;
  }
  return JSON.parse(text) as never;
}

describe("REST", () => {
  it("GET /api/health returns the snapshot", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      snapshot: { runId: "run-2", manifestCid: "bafy-manifest", syncedAt: "2026-10-07T18:00:00Z" },
    });
  });

  it("GET /api/leads/aged-roofs returns items", async () => {
    const res = await get(
      `/api/leads/aged-roofs?lat=${CENTER.lat}&lon=${CENTER.lon}&radiusMiles=5`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as {
      snapshot: unknown;
      items: { apn: string; roofAgeYears: number }[];
    };
    expect(body.items).toEqual([expect.objectContaining({ apn: "B-002", roofAgeYears: 20 })]);
  });

  it("GET /api/leads/open-permits parses roofingOnly and defaults state to any", async () => {
    const res = await get(
      `/api/leads/open-permits?lat=${CENTER.lat}&lon=${CENTER.lon}&roofingOnly=false&minOpenYears=2`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { permitState: string }[] };
    expect(body.items.map((i) => i.permitState)).toEqual(["open"]);
  });

  it("GET /api/properties/radius with invalid lat returns 400 with issues", async () => {
    const res = await get("/api/properties/radius?lat=abc&lon=-121.88");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("GET /api/properties/:apn returns detail or 404", async () => {
    expect((await get("/api/properties/A-001")).status).toBe(200);
    expect((await get("/api/properties/nope")).status).toBe(404);
  });

  it("GET /api/contractors/:id, /api/runs, /api/manifest", async () => {
    expect((await get("/api/contractors/acme-roofing")).status).toBe(200);
    expect(((await (await get("/api/runs")).json()) as unknown[]).length).toBe(2);
    expect(await (await get("/api/manifest")).json()).toEqual({ schema: "scc-manifest/1" });
  });

  it("unknown route returns 404 JSON", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});

describe("MCP", () => {
  it("GET and DELETE /mcp return 405 (stateless)", async () => {
    expect((await get("/mcp")).status).toBe(405);
    expect((await exports.default.fetch(`${BASE}/mcp`, { method: "DELETE" })).status).toBe(405);
  });

  it("POST /mcp with a malformed body is a JSON-RPC client error, not a 500", async () => {
    const res = await exports.default.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("initialize, tools/list and tools/call find_aged_roofs", async () => {
    const init = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    expect(init.result).toMatchObject({
      serverInfo: { name: "santa-clara-property-intelligence", version: "0.1.0" },
    });

    const list = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = (list.result!["tools"] as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "find_aged_roofs",
        "find_open_roofing_permits",
        "get_contractor",
        "get_manifest",
        "get_property",
        "list_runs",
        "search_properties_in_radius",
      ].sort(),
    );

    const call = await mcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "find_aged_roofs",
        arguments: { lat: CENTER.lat, lon: CENTER.lon, radiusMiles: 5 },
      },
    });
    const content = call.result!["content"] as { type: string; text: string }[];
    expect(content[0]!.type).toBe("text");
    const payload = JSON.parse(content[0]!.text) as {
      snapshot: unknown;
      items: { roofAgeYears: number }[];
    };
    expect(payload.items).toEqual([expect.objectContaining({ roofAgeYears: 20 })]);
    expect(payload.snapshot).toMatchObject({ manifestCid: "bafy-manifest" });
  });
});
