// The json api. dots, scripts and the pages all go through these handlers.
//
//   data                                   schema (tabs and their fields; every change is logged)
//   GET    /api                            GET    /api/_tabs/<slug>
//   GET    /api/<tab>?q=&limit=&offset=    PUT    /api/_tabs/<slug>      create or replace a tab definition
//   GET    /api/<tab>/<id>                 DELETE /api/_tabs/<slug>      only when the tab has no rows
//   POST   /api/<tab>                      GET    /api/_log?limit=       recent schema changes
//   PATCH  /api/<tab>/<id>                 GET    /api/_docs             this api's contract (docs/seniorintern-api.md), as markdown
//   DELETE /api/<tab>/<id>
import docs from "../../../docs/seniorintern-api.md?raw"; // bundled at deploy, so the contract always matches the running code
import * as db from "./db.ts";
import { checkDefinition, checkRow, SLUG } from "./schema.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (status: number, error: string) => json({ error }, status);
const API = {
  docs: "GET /api/_docs (the full contract, as markdown; read it before writing)",
  data: ["GET /api", "GET /api/<tab>?q=&limit=&offset= (pages: next_offset is null on the last)", "GET /api/<tab>/<id>", "POST /api/<tab>", "PATCH /api/<tab>/<id>", "DELETE /api/<tab>/<id>"],
  schema: ["GET /api/_tabs/<slug>", "PUT /api/_tabs/<slug>", "DELETE /api/_tabs/<slug>", "GET /api/_log"],
  field_types: ["text", "int (min, max, unit)", "number (decimals; min, max, unit)", "date (2026-11-18)", "datetime (2026-11-18 or 2026-11-18T09:30-08:00)",
    "url", "enum (options: [...])", "lifts ('flat db press: 45x10, 50x8; pull up: bwx10, +25x6'; 50x8x3 = three sets; unit lb by default)"],
  views: ["progress (lifts field)", "strip (date field, label, days)", "line (field, tab)", "upcoming (date field, where, limit)", "calibration (confidence, verdict, right, min)"],
};

export async function handleApi(request: Request, database: D1Database, who: string): Promise<Response> {
  const url = new URL(request.url);
  const [, , first, second, extra] = url.pathname.split("/"); // "", "api", first, second
  const body = () => request.json().catch(() => undefined);
  const limit = (fallback: number) => Math.min(Math.max(Number(url.searchParams.get("limit") ?? fallback) || fallback, 1), 1000);

  if (!first) {
    if (request.method !== "GET") return fail(405, "use GET");
    const [tabs, counts] = await Promise.all([db.tabs(database), db.counts(database)]);
    return json({ tabs: tabs.map((t) => ({ ...t, rows: counts.get(t.slug) ?? 0 })), api: API });
  }

  if (first === "_docs") {
    if (request.method !== "GET") return fail(405, "use GET");
    return new Response(docs, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  }

  if (first === "_log") {
    if (request.method !== "GET") return fail(405, "use GET");
    return json({ changes: await db.schemaLog(database, limit(50)) });
  }

  if (first === "_tabs") {
    if (!second || extra !== undefined) return fail(404, "use /api/_tabs/<slug>");
    if (!SLUG.test(second)) return fail(400, "tab slug must be lowercase letters, digits and hyphens, starting with a letter");
    const current = await db.tab(database, second);
    if (request.method === "GET") return current ? json({ tab: current }) : fail(404, "no such tab");
    if (request.method === "PUT") {
      const definition = checkDefinition(await body());
      if (typeof definition === "string") return fail(400, definition);
      const { tab, created } = await db.putTab(database, second, definition, who);
      return json({ tab }, created ? 201 : 200);
    }
    if (request.method === "DELETE") {
      if (!current) return fail(404, "no such tab");
      return (await db.deleteTab(database, current, who)) ? json({ deleted: second }) : fail(409, "tab still has rows; delete them first");
    }
    return fail(405, "use GET, PUT or DELETE");
  }

  const tab = await db.tab(database, first);
  if (!tab || extra !== undefined) {
    const known = (await db.tabs(database)).map((t) => t.slug).join(", ");
    return fail(404, `no such tab. tabs: ${known}`);
  }

  if (second === undefined || second === "") {
    if (request.method === "GET") {
      // pages: ask for one more than the limit to know whether there is a next page
      const n = limit(100), offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset") ?? 0)) || 0);
      const rows = await db.list(database, tab, { q: url.searchParams.get("q") ?? undefined, limit: n + 1, offset });
      return json({ rows: rows.slice(0, n), next_offset: rows.length > n ? offset + n : null });
    }
    if (request.method === "POST") {
      const change = checkRow(tab, await body(), { partial: false });
      if (typeof change === "string") return fail(400, change);
      return json({ row: await db.insert(database, tab.slug, change.set, who) }, 201);
    }
    return fail(405, "use GET or POST");
  }

  const id = Number(second);
  if (!Number.isInteger(id)) return fail(404, "id must be a number");
  if (request.method === "GET") {
    const row = await db.get(database, tab.slug, id);
    return row ? json({ row }) : fail(404, "no such row");
  }
  if (request.method === "PATCH") {
    const change = checkRow(tab, await body(), { partial: true });
    if (typeof change === "string") return fail(400, change);
    const row = await db.update(database, tab.slug, id, change, who);
    return row ? json({ row }) : fail(404, "no such row");
  }
  if (request.method === "DELETE") return (await db.remove(database, tab.slug, id)) ? json({ deleted: id }) : fail(404, "no such row");
  return fail(405, "use GET, PATCH or DELETE");
}
