// The json api. dots and scripts go through these handlers; the pages (src/page.ts) read the same db.
//
//   data                                   schema (tabs and their fields; every change is logged)
//   GET    /api                            GET    /api/_tabs/<slug>
//   GET    /api/<tab>?q=&limit=&offset=    PUT    /api/_tabs/<slug>      create or replace a tab definition
//   GET    /api/<tab>/<id>                 DELETE /api/_tabs/<slug>      only when the tab has no rows
//   POST   /api/<tab>                      GET    /api/_log?limit=       recent schema changes
//   PATCH  /api/<tab>/<id>                 GET    /api/_docs             the core contract (docs/core.md), as markdown
//                                          GET    /api/_docs/<name>      a tab's rules (docs/<tab>.md), or the schema's
//                                          GET    /api/_skills           the skills: name and when to use each
//                                          GET    /api/_skills/<name>    one skill (skills/<name>.md), as markdown
//   DELETE /api/<tab>/<id>
//   GET    /api/<tab>/<id>/series          a row's intraday detail (a health day's heart rate, overnight hrv)
//   GET    /api/<tab>/_views               what the tab's page opens on, as numbers (verdicts, load, limits, records)
//   GET    /api/_agents                    everything an agent starts with: adhi's AGENTS.md (personal, so in d1, never in
//                                          this public repo), then core.md (the api and the skills), joined per request
//   PUT    /api/_agents                    replace the AGENTS.md part: adhi only, signed in through access; never an agent
// the contract, bundled at deploy so it always matches the running code: core.md, then a page per tab and schema.md
const DOCS = Object.fromEntries(Object.entries(import.meta.glob<string>("../docs/*.md", { query: "?raw", import: "default", eager: true }))
  .map(([path, text]) => [path.slice("../docs/".length, -".md".length), text]));
// skills: procedures an agent follows (the fitness coach), one file each, read when one applies. core.md lists them by name and
// when to use each, so the agent knows they exist from its instructions; a test fails if a skill is missing from that list
const SKILLS = Object.fromEntries(Object.entries(import.meta.glob<string>("../skills/*.md", { query: "?raw", import: "default", eager: true }))
  .map(([path, text]) => [path.slice("../skills/".length, -".md".length), text]));
const markdown = (text: string) => new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
import { claim, TRAINING } from "./activities.ts";
import * as db from "./db.ts";
import { todayHere } from "./here.ts";
import { described } from "./live.ts";
import { linksTo, renamed, resolve } from "./refs.ts";
import { checkDefinition, checkRow, SLUG } from "./schema.ts";
import { computeViews } from "./views.ts";

const AGENTS = "agents.md"; // the meta key holding the agent's instructions
const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (status: number, error: string) => json({ error }, status);
const API = {
  agents: "GET /api/_agents (your instructions and this api's core, as markdown: read it first)",
  skills: "GET /api/_skills (name and when to use each); GET /api/_skills/<name> (follow it when it applies)",
  docs: "GET /api/_docs/<tab> (that tab's rules: read before your first write to it); GET /api/_docs/schema (changing tabs)",
  data: ["GET /api", "GET /api/<tab>?q=&limit=&offset= (pages: next_offset is null on the last)", "GET /api/<tab>/_views (the page's views as numbers: start here)", "GET /api/<tab>/<id>", "POST /api/<tab>", "PATCH /api/<tab>/<id>", "DELETE /api/<tab>/<id>"],
  schema: ["GET /api/_tabs/<slug>", "PUT /api/_tabs/<slug>", "DELETE /api/_tabs/<slug>", "GET /api/_log"],
  field_types: ["text", "int (min, max, unit)", "number (decimals; min, max, unit)", "date (2026-11-18)", "datetime (2026-11-18 or 2026-11-18T09:30-08:00; time: true requires the time and offset)",
    "url", "enum (options: [...])", "lifts ('flat db press: 45x10, 50x8; pull up: bwx10, +25x6'; 50x8x3 = three sets; unit lb by default)",
    "ref (to: <tab>; the title of a row there, like \"Acme\"; many: true for a list; a name with no row creates it)"],
  views: ["progress (lifts field)", "strip (date field, label, days)", "line (field, tab)", "upcoming (date field, where, limit)", "calibration (confidence, verdict, right, min)", "list (label, where, sort, aside)", "metrics (label, metrics: [{ field, better, finished, change, stream, limit, per, goal, label, scale, log }])",
    "load (field)", "limit (field, where, days, over)", "weeks (by, fields, zones, weeks)", "records (records: [{ label, field, best: max|min, where }], days)", "graph (label): rows as nodes, refs as edges"],
};

export async function handleApi(request: Request, database: D1Database, who: string, birthday?: string): Promise<Response> {
  const url = new URL(request.url);
  const [, , first, second, extra] = url.pathname.split("/"); // "", "api", first, second
  const body = () => request.json().catch(() => undefined);
  const limit = (fallback: number) => Math.min(Math.max(Number(url.searchParams.get("limit") ?? fallback) || fallback, 1), 1000);

  if (!first) {
    if (request.method !== "GET") return fail(405, "use GET");
    const [tabs, counts, today] = await Promise.all([db.tabs(database), db.counts(database), todayHere(database)]);
    // each tab as home shows it (a live description is worked out now); GET /api/_tabs/<slug> keeps the definition as written
    return json({ tabs: tabs.map((t) => ({ ...described(t, birthday, today), rows: counts.get(t.slug) ?? 0 })), skills: Object.keys(SKILLS).sort(), api: API });
  }

  if (first === "_docs") {
    if (request.method !== "GET") return fail(405, "use GET");
    const name = second ?? "core";
    if (extra !== undefined || !Object.hasOwn(DOCS, name)) return fail(404, `no such page; there are: ${Object.keys(DOCS).filter((n) => n !== "core").sort().join(", ")}`);
    return markdown(DOCS[name]);
  }

  if (first === "_skills") {
    if (request.method !== "GET") return fail(405, "use GET");
    if (second === undefined) return json({ skills: Object.keys(SKILLS).sort().map((name) => ({ name, read: `GET /api/_skills/${name}` })) });
    return Object.hasOwn(SKILLS, second) && extra === undefined ? markdown(SKILLS[second]) : fail(404, `no such skill; there are: ${Object.keys(SKILLS).sort().join(", ")}`);
  }

  if (first === "_agents") {
    // the source of truth is adhi's drive (obsidian/ai-configs/built); scripts/push-agents.sh copies it here.
    // an agent may read its instructions but never rewrite them, so only a signed-in person can PUT
    if (second !== undefined) return fail(404, "use /api/_agents");
    if (request.method === "GET") {
      // who the agent is, then how to use senior intern: one read, so the api is part of its instructions, not a lookup
      const mine = await db.getMeta(database, AGENTS);
      return markdown(mine === null ? DOCS.core : `${mine.trimEnd()}\n\n---\n\n${DOCS.core}`);
    }
    if (request.method !== "PUT") return fail(405, "use GET or PUT");
    if (who.startsWith("service:")) return fail(403, "agents can read their instructions, not change them");
    const text = await request.text();
    if (!text.trim()) return fail(400, "send the instructions as the body, in markdown");
    if (text.length > 100_000) return fail(400, "instructions must be under 100,000 characters");
    await db.setMeta(database, AGENTS, text).run();
    return json({ saved: text.length, by: who });
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
      // "after": a tab slug to sit right after in the home page's order; it isn't part of the definition
      const raw = await body(), after = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).after : undefined;
      if (after !== undefined && (typeof after !== "string" || after === second || !(await db.tab(database, after)))) return fail(400, '"after" must be the slug of another tab');
      const { after: _a, ...rest } = (raw ?? {}) as Record<string, unknown>;
      const definition = checkDefinition(after === undefined ? raw : rest);
      if (typeof definition === "string") return fail(400, definition);
      for (const f of definition.fields) if (f.type === "ref" && f.to !== second && !(await db.tab(database, f.to!))) return fail(400, `field "${f.name}": no tab "${f.to}" to link to; define it first`);
      const { created } = await db.putTab(database, second, definition, who);
      if (after !== undefined) await db.placeAfter(database, second, after as string);
      return json({ tab: await db.tab(database, second) }, created ? 201 : 200);
    }
    if (request.method === "DELETE") {
      if (!current) return fail(404, "no such tab");
      return (await db.deleteTab(database, current, who)) ? json({ deleted: second }) : fail(409, "tab still has rows; delete them first");
    }
    return fail(405, "use GET, PUT or DELETE");
  }

  const tab = await db.tab(database, first);
  if (tab && second === "_views" && extra === undefined) {
    // what the tab's page opens on, as numbers: the same computation as the page, so an agent reads exactly what it shows
    if (request.method !== "GET") return fail(405, "use GET");
    return json({ views: (await computeViews(tab, database)).map(({ kind, label, data, page }) => ({ kind, label, on_page: page, ...data })) });
  }
  if (tab && extra === "series" && Number.isInteger(Number(second))) {
    if (request.method !== "GET") return fail(405, "use GET; the garmin sync writes series");
    const row = await db.get(database, tab.slug, Number(second));
    if (!row) return fail(404, "no such row");
    return json({ series: (await db.getSeries(database, row.id)) ?? {} });
  }
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
      const refused = await resolve(database, tab, change.set, who, {});
      if (refused) return fail(409, refused);
      // a session garmin already stored (the watch synced first) becomes one row with it, not two
      const merged = tab.slug === TRAINING ? await claim(database, tab, change.set, who) : null;
      if (merged) return json({ row: merged, merged: "garmin" }, 200);
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
    const before = await db.get(database, tab.slug, id);
    if (!before) return fail(404, "no such row");
    const refused = await resolve(database, tab, change.set, who, { id, title: before[tab.title] as string | undefined });
    if (refused) return fail(409, refused);
    const row = (await db.update(database, tab.slug, id, change, who))!;
    if (before[tab.title] !== undefined && row[tab.title] !== undefined) await renamed(database, tab, String(before[tab.title]), String(row[tab.title]), who);
    return json({ row });
  }
  if (request.method === "DELETE") {
    const row = await db.get(database, tab.slug, id);
    if (!row) return fail(404, "no such row");
    const linked = row[tab.title] === undefined ? [] : await linksTo(database, tab, String(row[tab.title]));
    if (linked.length) return fail(409, `still linked from ${linked.join(", ")}: unlink them first`);
    await db.remove(database, tab.slug, id);
    return json({ deleted: id });
  }
  return fail(405, "use GET, PATCH or DELETE");
}
