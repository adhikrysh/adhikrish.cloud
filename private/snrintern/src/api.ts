// The json api. dots, scripts and the page all go through these handlers.
//
//   GET    /api                  tabs, their fields and row counts
//   GET    /api/<tab>?q=&limit=  rows, newest first; q searches every text field
//   GET    /api/<tab>/<id>       one row
//   POST   /api/<tab>            add a row             body: { field: value, ... }
//   PATCH  /api/<tab>/<id>       change some fields     body: { field: value, ... }
//   DELETE /api/<tab>/<id>       delete a row
import * as db from "./db.ts";
import { TABS, tabBySlug, type Tab } from "./tabs.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (status: number, error: string) => json({ error }, status);

/** Checks a request body against the tab's fields. Returns the clean values or an error message. */
export function validate(tab: Tab, body: unknown, { partial }: { partial: boolean }): db.Row | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "body must be a json object";
  const values: db.Row = {};
  const known = new Map(tab.fields.map((f) => [f.name, f]));
  for (const [name, value] of Object.entries(body)) {
    const field = known.get(name);
    if (!field) return `unknown field "${name}". fields: ${tab.fields.map((f) => f.name).join(", ")}`;
    if (value === null || value === "") {
      if (field.required) return `"${name}" is required`;
      values[name] = null;
    } else if (field.type === "int") {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(n)) return `"${name}" must be a whole number`;
      values[name] = n;
    } else {
      if (typeof value !== "string" && typeof value !== "number") return `"${name}" must be text`;
      values[name] = String(value);
    }
  }
  if (!partial) {
    for (const field of tab.fields) if (field.required && values[field.name] == null) return `"${field.name}" is required`;
  }
  if (Object.keys(values).length === 0) return "no fields given";
  return values;
}

export async function handleApi(request: Request, database: D1Database, who: string): Promise<Response> {
  const url = new URL(request.url);
  const [, , slug, idPart, extra] = url.pathname.split("/"); // "", "api", tab, id
  if (!slug) {
    if (request.method !== "GET") return fail(405, "use GET");
    const rows = await db.counts(database, TABS);
    return json({
      tabs: TABS.map((t, i) => ({ slug: t.slug, label: t.label, rows: rows[i], fields: t.fields })),
      api: ["GET /api/<tab>?q=&limit=", "GET /api/<tab>/<id>", "POST /api/<tab>", "PATCH /api/<tab>/<id>", "DELETE /api/<tab>/<id>"],
    });
  }
  const tab = tabBySlug.get(slug);
  if (!tab || extra !== undefined) return fail(404, `no such tab. tabs: ${TABS.map((t) => t.slug).join(", ")}`);

  if (idPart === undefined || idPart === "") {
    if (request.method === "GET") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 1000);
      return json({ rows: await db.list(database, tab, { q: url.searchParams.get("q") ?? undefined, limit }) });
    }
    if (request.method === "POST") {
      const values = validate(tab, await request.json().catch(() => undefined), { partial: false });
      if (typeof values === "string") return fail(400, values);
      return json({ row: await db.insert(database, tab, values, who) }, 201);
    }
    return fail(405, "use GET or POST");
  }

  const id = Number(idPart);
  if (!Number.isInteger(id)) return fail(404, "id must be a number");
  if (request.method === "GET") {
    const row = await db.get(database, tab, id);
    return row ? json({ row }) : fail(404, "no such row");
  }
  if (request.method === "PATCH") {
    const values = validate(tab, await request.json().catch(() => undefined), { partial: true });
    if (typeof values === "string") return fail(400, values);
    const row = await db.update(database, tab, id, values, who);
    return row ? json({ row }) : fail(404, "no such row");
  }
  if (request.method === "DELETE") {
    return await db.remove(database, tab, id) ? json({ deleted: id }) : fail(404, "no such row");
  }
  return fail(405, "use GET, PATCH or DELETE");
}
