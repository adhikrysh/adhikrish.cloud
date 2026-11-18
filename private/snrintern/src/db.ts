// D1 access. Tabs are rows in `tabs` holding a json definition; data rows are json documents in `rows`.
// Every value, including json paths, goes through a bound parameter.
import type { Data, Tab, TabDefinition } from "./schema.ts";

export type Row = { id: number; created_at: string; updated_at: string; updated_by: string } & Data;

type TabRecord = { slug: string; position: number; definition: string };
type RowRecord = { id: number; data: string; created_at: string; updated_at: string; updated_by: string };

const toTab = (r: TabRecord): Tab => ({ slug: r.slug, position: r.position, ...JSON.parse(r.definition) });
const toRow = (r: RowRecord): Row => ({ id: r.id, created_at: r.created_at, updated_at: r.updated_at, updated_by: r.updated_by, ...JSON.parse(r.data) });

export async function tabs(db: D1Database): Promise<Tab[]> {
  return (await db.prepare("SELECT slug, position, definition FROM tabs ORDER BY position, slug").all<TabRecord>()).results.map(toTab);
}

export async function tab(db: D1Database, slug: string): Promise<Tab | null> {
  const r = await db.prepare("SELECT slug, position, definition FROM tabs WHERE slug = ?").bind(slug).first<TabRecord>();
  return r ? toTab(r) : null;
}

/** Creates or replaces a tab definition, and logs the change. */
export async function putTab(db: D1Database, slug: string, definition: TabDefinition, by: string): Promise<{ tab: Tab; created: boolean }> {
  const before = await tab(db, slug);
  const at = new Date().toISOString();
  const json = JSON.stringify(definition);
  const write = before
    ? db.prepare("UPDATE tabs SET definition = ?, updated_at = ?, updated_by = ? WHERE slug = ?").bind(json, at, by, slug)
    : db.prepare("INSERT INTO tabs (slug, position, definition, updated_at, updated_by) VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM tabs), ?, ?, ?)").bind(slug, json, at, by);
  const { slug: _s, position: _p, ...beforeDefinition } = before ?? ({} as Tab);
  await db.batch([
    write,
    db.prepare("INSERT INTO schema_log (at, by, tab, before, after) VALUES (?, ?, ?, ?, ?)").bind(at, by, slug, before ? JSON.stringify(beforeDefinition) : null, json),
  ]);
  return { tab: (await tab(db, slug))!, created: !before };
}

/** Deletes a tab that has no rows, and logs it. Returns false if it still has rows. */
export async function deleteTab(db: D1Database, current: Tab, by: string): Promise<boolean> {
  if ((await count(db, current.slug)) > 0) return false;
  const { slug, position: _p, ...definition } = current;
  await db.batch([
    db.prepare("DELETE FROM tabs WHERE slug = ?").bind(slug),
    db.prepare("INSERT INTO schema_log (at, by, tab, before, after) VALUES (?, ?, ?, ?, NULL)").bind(new Date().toISOString(), by, slug, JSON.stringify(definition)),
  ]);
  return true;
}

export async function schemaLog(db: D1Database, limit: number) {
  return (await db.prepare("SELECT id, at, by, tab, before, after FROM schema_log ORDER BY id DESC LIMIT ?").bind(limit).all()).results
    .map((r: any) => ({ ...r, before: r.before && JSON.parse(r.before), after: r.after && JSON.parse(r.after) }));
}

export async function count(db: D1Database, slug: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM rows WHERE tab = ?").bind(slug).first<{ n: number }>())!.n;
}

export async function counts(db: D1Database): Promise<Map<string, number>> {
  const r = await db.prepare("SELECT tab, COUNT(*) AS n FROM rows GROUP BY tab").all<{ tab: string; n: number }>();
  return new Map(r.results.map((x) => [x.tab, x.n]));
}

/** Rows of a tab, sorted by the tab's sort field (newest or largest first, empty last). q matches any value.
 * No limit means every row: views and charts must see all of them, however many years of rows there are. */
export async function list(db: D1Database, t: Tab, { q, limit, offset = 0 }: { q?: string; limit?: number; offset?: number } = {}): Promise<Row[]> {
  const order = t.sort === "id" ? "id DESC" : "json_extract(data, ?) IS NULL, json_extract(data, ?) DESC, id DESC";
  const sortBinds = t.sort === "id" ? [] : [`$.${t.sort}`, `$.${t.sort}`];
  const where = q ? "AND EXISTS (SELECT 1 FROM json_each(rows.data) WHERE CAST(json_each.value AS TEXT) LIKE ?)" : "";
  const binds = [t.slug, ...(q ? [`%${q}%`] : []), ...sortBinds, limit ?? -1, offset]; // LIMIT -1: no limit in sqlite
  const sql = `SELECT id, data, created_at, updated_at, updated_by FROM rows WHERE tab = ? ${where} ORDER BY ${order} LIMIT ? OFFSET ?`;
  return (await db.prepare(sql).bind(...binds).all<RowRecord>()).results.map(toRow);
}

export async function get(db: D1Database, slug: string, id: number): Promise<Row | null> {
  const r = await db.prepare("SELECT id, data, created_at, updated_at, updated_by FROM rows WHERE tab = ? AND id = ?").bind(slug, id).first<RowRecord>();
  return r ? toRow(r) : null;
}

export async function insert(db: D1Database, slug: string, data: Data, by: string): Promise<Row> {
  const at = new Date().toISOString();
  const r = await db.prepare("INSERT INTO rows (tab, data, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) RETURNING id, data, created_at, updated_at, updated_by")
    .bind(slug, JSON.stringify(data), at, at, by).first<RowRecord>();
  return toRow(r!);
}

/** Sets and removes fields on one row. Returns null if the row doesn't exist. */
export async function update(db: D1Database, slug: string, id: number, change: { set: Data; unset: string[] }, by: string): Promise<Row | null> {
  const current = await db.prepare("SELECT data FROM rows WHERE tab = ? AND id = ?").bind(slug, id).first<{ data: string }>();
  if (!current) return null;
  const data: Data = { ...JSON.parse(current.data), ...change.set };
  for (const name of change.unset) delete data[name];
  const r = await db.prepare("UPDATE rows SET data = ?, updated_at = ?, updated_by = ? WHERE tab = ? AND id = ? RETURNING id, data, created_at, updated_at, updated_by")
    .bind(JSON.stringify(data), new Date().toISOString(), by, slug, id).first<RowRecord>();
  return toRow(r!);
}

export async function remove(db: D1Database, slug: string, id: number): Promise<boolean> {
  return (await db.prepare("DELETE FROM rows WHERE tab = ? AND id = ?").bind(slug, id).run()).meta.changes > 0;
}

