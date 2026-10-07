import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import * as q from "./queries";
import { AgedRoofsQuery, OpenPermitsQuery, RadiusQuery } from "./schemas";
import { registerTools } from "./tools";

type Env = { Bindings: { DB: D1Database } };

const app = new Hono<Env>();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

app.get("/api/health", async (c) => c.json({ ok: true, snapshot: await q.snapshot(c.env.DB) }));

app.get("/api/properties/radius", async (c) => {
  const p = RadiusQuery.parse(c.req.query());
  return c.json({ snapshot: await q.snapshot(c.env.DB), items: await q.radius(c.env.DB, p) });
});

app.get("/api/leads/aged-roofs", async (c) => {
  const p = AgedRoofsQuery.parse(c.req.query());
  return c.json({ snapshot: await q.snapshot(c.env.DB), items: await q.agedRoofs(c.env.DB, p) });
});

app.get("/api/leads/open-permits", async (c) => {
  const p = OpenPermitsQuery.parse(c.req.query());
  return c.json({ snapshot: await q.snapshot(c.env.DB), items: await q.openPermits(c.env.DB, p) });
});

app.get("/api/properties/:apn", async (c) => {
  const r = await q.property(c.env.DB, c.req.param("apn"));
  return r ? c.json(r) : c.json({ error: "not found" }, 404);
});

app.get("/api/contractors/:id", async (c) => {
  const r = await q.contractor(c.env.DB, c.req.param("id"));
  return r ? c.json(r) : c.json({ error: "not found" }, 404);
});

app.get("/api/runs", async (c) => c.json(await q.runs(c.env.DB)));
app.get("/api/manifest", async (c) => c.json(await q.manifest(c.env.DB)));

app.post("/mcp", async (c) => {
  const server = new McpServer({ name: "santa-clara-property-intelligence", version: "0.1.0" });
  registerTools(server, c.env.DB);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

// Stateless transport: no sessions, so no standalone SSE stream (GET) or session termination (DELETE).
app.on(["GET", "DELETE"], "/mcp", (c) =>
  c.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server: POST only)." },
      id: null,
    },
    405,
    { Allow: "POST" },
  ),
);

app.notFound((c) => c.json({ error: "not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof ZodError) return c.json({ error: "invalid request", issues: err.issues }, 400);
  return c.json({ error: err.message }, 500);
});

export default app;
