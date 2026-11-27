// Links between rows. A ref field holds the title of a row in another tab (or its own): a person's `company` is "Acme", the
// name of a row in companies. That is how a wiki links pages by name, and it keeps every row readable on its own: an agent
// reads "Acme", never an id it has to look up. What keeps the names honest:
//   write   a name is matched to its row ignoring case and stored as that row's own title; a name with no row creates one
//   unique  a tab that refs point into can't hold two rows with one title, so a name always means one row
//   rename  changing a title rewrites every ref to it
//   delete  a row something links to can't be deleted until those links are gone
// The graph is the rows as nodes and the refs as edges, computed when asked, like every view.
import * as db from "./db.ts";
import type { Data, Field, Tab, Value } from "./schema.ts";

type Titles = Map<string, { id: number; title: string }[]>; // lowercased title: the rows that carry it
const key = (s: unknown) => String(s ?? "").trim().toLowerCase();
const refs = (t: Tab) => t.fields.filter((f): f is Field & { to: string } => f.type === "ref" && !!f.to);
const names = (v: Value | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [String(v)]);

async function titles(database: D1Database, t: Tab): Promise<Titles> {
  const r = await database.prepare("SELECT id, json_extract(data, ?) AS title FROM rows WHERE tab = ?").bind(`$.${t.title}`, t.slug).all<{ id: number; title: string | null }>();
  const out: Titles = new Map();
  for (const x of r.results) if (x.title !== null) out.set(key(x.title), [...(out.get(key(x.title)) ?? []), { id: x.id, title: String(x.title) }]);
  return out;
}

/** The ref fields across every tab that point into `t`. */
const pointingAt = (all: Tab[], t: Tab) => all.flatMap((o) => refs(o).filter((f) => f.to === t.slug).map((f) => ({ tab: o, field: f })));

/** Before a write to `tab`: checks its title is free (when refs point into the tab), then resolves every ref in `set` to the
 * title of an existing row, creating the rows that don't exist yet. `self` is the row being written (its id and title),
 * so a person never links to themself. Returns an error, or null with `set` rewritten in place. */
export async function resolve(database: D1Database, tab: Tab, set: Data, who: string, self: { id?: number; title?: string }): Promise<string | null> {
  const all = await db.tabs(database);
  if (set[tab.title] !== undefined && pointingAt(all, tab).length) {
    const taken = ((await titles(database, tab)).get(key(set[tab.title])) ?? []).find((r) => r.id !== self.id);
    if (taken) return `${tab.label} already has "${taken.title}" (id ${taken.id}): patch that row instead, or give this one another ${tab.title}`;
  }
  const own = key(set[tab.title] ?? self.title);
  const plan: { field: Field & { to: string }; target: Tab; wanted: string[] }[] = [];
  for (const field of refs(tab).filter((f) => set[f.name] !== undefined)) {
    const target = all.find((t) => t.slug === field.to);
    if (!target) return `"${field.name}" links to the tab "${field.to}", which doesn't exist`;
    plan.push({ field, target, wanted: names(set[field.name]).filter((n) => !(target.slug === tab.slug && key(n) === own)) });
  }
  // check everything before creating anything, so a refused write leaves no stray rows behind
  const known = new Map<string, Titles>();
  for (const p of plan) {
    if (!known.has(p.target.slug)) known.set(p.target.slug, await titles(database, p.target));
    const index = known.get(p.target.slug)!;
    for (const n of p.wanted) {
      const found = index.get(key(n)) ?? [];
      if (found.length > 1) return `${p.target.label} has ${found.length} rows titled "${n}" (ids ${found.map((r) => r.id).join(", ")}): rename one first`;
      const needs = p.target.fields.filter((f) => f.required && f.name !== p.target.title).map((f) => f.name);
      if (!found.length && needs.length) return `"${n}" isn't in ${p.target.label} yet, and a new one needs ${needs.join(", ")}: add it there first`;
    }
  }
  for (const p of plan) {
    const index = known.get(p.target.slug)!;
    const resolved: string[] = [];
    for (const n of p.wanted) {
      let row = index.get(key(n))?.[0];
      if (!row) {
        const made = await db.insert(database, p.target.slug, { [p.target.title]: n }, who);
        row = { id: made.id, title: n };
        index.set(key(n), [row]);
      }
      if (!resolved.includes(row.title)) resolved.push(row.title);
    }
    if (p.field.many) set[p.field.name] = resolved;
    else if (resolved.length) set[p.field.name] = resolved[0];
    else delete set[p.field.name]; // a person whose only link was to themself
  }
  return null;
}

// rows of `tab` whose `field` is `title`, or holds it in its list (json_each walks a list, or yields a single value as itself)
const HOLDS = "tab = ? AND EXISTS (SELECT 1 FROM json_each(rows.data, ?) WHERE json_each.value = ?)";

/** After a row's title changed from `before` to `after`: every ref to it now reads the new title. */
export async function renamed(database: D1Database, tab: Tab, before: string, after: string, who: string): Promise<void> {
  if (before === after) return;
  const at = new Date().toISOString(), writes: D1PreparedStatement[] = [];
  for (const { tab: o, field } of pointingAt(await db.tabs(database), tab)) {
    const path = `$.${field.name}`;
    const r = await database.prepare(`SELECT id, json_extract(data, ?) AS v FROM rows WHERE ${HOLDS}`).bind(path, o.slug, path, before).all<{ id: number; v: string }>();
    for (const x of r.results) {
      const v = field.many ? [...new Set((JSON.parse(x.v) as string[]).map((n) => (n === before ? after : n)))] : after;
      writes.push(database.prepare("UPDATE rows SET data = json_set(data, ?, json(?)), updated_at = ?, updated_by = ? WHERE id = ?").bind(path, JSON.stringify(v), at, who, x.id));
    }
  }
  if (writes.length) await database.batch(writes);
}

/** What links to a row, as "people.company (2 rows)": empty when it can be deleted. */
export async function linksTo(database: D1Database, tab: Tab, title: string): Promise<string[]> {
  const out: string[] = [];
  for (const { tab: o, field } of pointingAt(await db.tabs(database), tab)) {
    const n = (await database.prepare(`SELECT COUNT(*) AS n FROM rows WHERE ${HOLDS}`).bind(o.slug, `$.${field.name}`, title).first<{ n: number }>())!.n;
    if (n) out.push(`${o.slug}.${field.name} (${n} row${n === 1 ? "" : "s"})`);
  }
  return out;
}

export type Node = { id: string; tab: string; row: number; label: string; data: Data };
export type Edge = { from: string; to: string; field: string };
export type Graph = { tabs: { slug: string; label: string }[]; nodes: Node[]; edges: Edge[] };

/** The tab's rows and every tab its refs reach (people: companies, events, people), as nodes; each ref as an edge. */
export async function graph(database: D1Database, start: Tab): Promise<Graph> {
  const all = await db.tabs(database);
  const reached: Tab[] = [start];
  for (let i = 0; i < reached.length; i++) for (const f of refs(reached[i])) {
    const t = all.find((x) => x.slug === f.to);
    if (t && !reached.some((r) => r.slug === t.slug)) reached.push(t);
  }
  const rows = await Promise.all(reached.map((t) => db.list(database, t)));
  const ids = new Map(reached.map((t, i) => [t.slug, new Map(rows[i].map((r) => [key(r[t.title]), `${t.slug}/${r.id}`]))]));
  const nodes: Node[] = [], edges: Edge[] = [];
  reached.forEach((t, i) => {
    const shown = t.fields.filter((f) => !f.hidden && f.name !== t.title);
    for (const r of rows[i]) {
      const id = `${t.slug}/${r.id}`;
      nodes.push({ id, tab: t.slug, row: r.id, label: String(r[t.title] ?? "untitled"),
        data: Object.fromEntries(shown.filter((f) => r[f.name] !== undefined && r[f.name] !== "").map((f) => [f.name, r[f.name]])) });
      for (const f of refs(t)) for (const n of names(r[f.name])) {
        const to = ids.get(f.to)?.get(key(n));
        if (to && to !== id) edges.push({ from: id, to, field: f.name });
      }
    }
  });
  return { tabs: reached.map((t) => ({ slug: t.slug, label: t.label })), nodes, edges };
}
