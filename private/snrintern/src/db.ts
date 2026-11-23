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


// ---- series: a row's intraday detail, read only by that row's page ----

export type Series = Record<string, { unit?: string; points: [number, number][] }>;

export async function getSeries(db: D1Database, rowId: number): Promise<Series | null> {
  const r = await db.prepare("SELECT data FROM series WHERE row_id = ?").bind(rowId).first<{ data: string }>();
  return r ? JSON.parse(r.data) : null;
}

export const putSeries = (db: D1Database, rowId: number, series: Series) =>
  db.prepare("INSERT INTO series (row_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (row_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(rowId, JSON.stringify(series), new Date().toISOString());

// ---- meta: small state kept between cron runs ----

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  return (await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
}

export const setMeta = (db: D1Database, key: string, value: string) =>
  db.prepare("INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value, new Date().toISOString());

// ---- rows keyed by one field (a day): what a sync writes and what the metrics view reads ----

/** Row ids by the value of `field`, for the given values (each day a sync touched). */
export async function idsBy(db: D1Database, slug: string, field: string, values: string[]): Promise<Map<string, number>> {
  if (!values.length) return new Map();
  const marks = values.map(() => "?").join(", ");
  const r = await db.prepare(`SELECT id, json_extract(data, ?) AS k FROM rows WHERE tab = ? AND json_extract(data, ?) IN (${marks})`)
    .bind(`$.${field}`, slug, `$.${field}`, ...values).all<{ id: number; k: string }>();
  return new Map(r.results.map((x) => [x.k, x.id]));
}

/** Inserts rows keyed by `field`, or merges each into the row that already has its key (json_patch: given fields replace,
 * others stay), in one batch; returns each key's row id. A sync merges, so what one call knows never wipes what another fetched. */
export async function mergeBy(db: D1Database, slug: string, field: string, rows: Data[], by: string): Promise<Map<string, number>> {
  const keys = rows.map((r) => String(r[field]));
  const existing = await idsBy(db, slug, field, keys);
  const at = new Date().toISOString();
  await db.batch(rows.map((data, i) => existing.has(keys[i])
    ? mergeInto(db, existing.get(keys[i])!, data, by, at)
    : db.prepare("INSERT INTO rows (tab, data, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)").bind(slug, JSON.stringify(data), at, at, by)));
  return idsBy(db, slug, field, keys);
}

/** Merges fields into one row's data. */
export const mergeInto = (db: D1Database, id: number, data: Data, by: string, at = new Date().toISOString()) =>
  db.prepare("UPDATE rows SET data = json_patch(data, ?), updated_at = ?, updated_by = ? WHERE id = ?").bind(JSON.stringify(data), at, by, id);

/** Rows whose date field is on or after `since` (yyyy-mm-dd), oldest first. */
export async function since(db: D1Database, t: Tab, dateField: string, from: string): Promise<Row[]> {
  return (await db.prepare("SELECT id, data, created_at, updated_at, updated_by FROM rows WHERE tab = ? AND json_extract(data, ?) >= ? ORDER BY json_extract(data, ?)")
    .bind(t.slug, `$.${dateField}`, from, `$.${dateField}`).all<RowRecord>()).results.map(toRow);
}

/** One number's whole history as (date, value) pairs, oldest first: sqlite picks the two values out, so years of rows cost no parsing here. */
export async function history(db: D1Database, t: Tab, dateField: string, field: string): Promise<{ date: string; value: number; id: number }[]> {
  return (await db.prepare("SELECT id, json_extract(data, ?) AS date, json_extract(data, ?) AS value FROM rows WHERE tab = ? AND value IS NOT NULL AND date IS NOT NULL ORDER BY date")
    .bind(`$.${dateField}`, `$.${field}`, t.slug).all<{ date: string; value: number; id: number }>()).results;
}

/** Each field's best value and its date (largest or smallest), in one round trip. */
export async function bests(db: D1Database, t: Tab, dateField: string, metrics: { field: string; better: "higher" | "lower" }[]) {
  if (!metrics.length) return [];
  const results = await db.batch<{ value: number; date: string; id: number }>(metrics.map((m) =>
    db.prepare(`SELECT id, json_extract(data, ?) AS value, json_extract(data, ?) AS date FROM rows WHERE tab = ? AND value IS NOT NULL ORDER BY value ${m.better === "higher" ? "DESC" : "ASC"}, date DESC LIMIT 1`)
      .bind(`$.${m.field}`, `$.${dateField}`, t.slug)));
  return results.map((r) => r.results[0] ?? null);
}

/** Rows of a tab that have no series yet, dated on or after `from`, newest first (the days a sync still owes their detail). */
export async function missingSeries(db: D1Database, slug: string, dateField: string, from: string, limit: number): Promise<{ id: number; date: string }[]> {
  return (await db.prepare(`SELECT rows.id AS id, json_extract(rows.data, ?) AS date FROM rows LEFT JOIN series ON series.row_id = rows.id
    WHERE rows.tab = ? AND series.row_id IS NULL AND date >= ? ORDER BY date DESC LIMIT ?`)
    .bind(`$.${dateField}`, slug, from, limit).all<{ id: number; date: string }>()).results;
}
