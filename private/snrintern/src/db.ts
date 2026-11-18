// D1 access. Table and column names only ever come from the tab registry, never from a request,
// so building them into sql is safe; every value goes through a bound parameter.
import { SYSTEM_FIELDS, type Tab } from "./tabs.ts";

export type Row = Record<string, string | number | null>;

const columns = (tab: Tab) => [...SYSTEM_FIELDS, ...tab.fields.map((f) => f.name)].join(", ");

export async function list(db: D1Database, tab: Tab, { q, limit }: { q?: string; limit: number }): Promise<Row[]> {
  if (!q) {
    return (await db.prepare(`SELECT ${columns(tab)} FROM ${tab.slug} ORDER BY id DESC LIMIT ?`).bind(limit).all<Row>()).results;
  }
  const haystack = tab.fields.filter((f) => f.type === "text").map((f) => `COALESCE(${f.name}, '')`).join(" || ' ' || ");
  return (await db.prepare(`SELECT ${columns(tab)} FROM ${tab.slug} WHERE ${haystack} LIKE ? ORDER BY id DESC LIMIT ?`)
    .bind(`%${q}%`, limit).all<Row>()).results;
}

export async function get(db: D1Database, tab: Tab, id: number): Promise<Row | null> {
  return db.prepare(`SELECT ${columns(tab)} FROM ${tab.slug} WHERE id = ?`).bind(id).first<Row>();
}

export async function insert(db: D1Database, tab: Tab, values: Row, by: string): Promise<Row> {
  const at = new Date().toISOString();
  const names = [...Object.keys(values), "created_at", "updated_at", "updated_by"];
  const row = await db.prepare(`INSERT INTO ${tab.slug} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")}) RETURNING ${columns(tab)}`)
    .bind(...Object.values(values), at, at, by).first<Row>();
  return row!;
}

export async function update(db: D1Database, tab: Tab, id: number, values: Row, by: string): Promise<Row | null> {
  const sets = [...Object.keys(values).map((n) => `${n} = ?`), "updated_at = ?", "updated_by = ?"].join(", ");
  return db.prepare(`UPDATE ${tab.slug} SET ${sets} WHERE id = ? RETURNING ${columns(tab)}`)
    .bind(...Object.values(values), new Date().toISOString(), by, id).first<Row>();
}

export async function remove(db: D1Database, tab: Tab, id: number): Promise<boolean> {
  return (await db.prepare(`DELETE FROM ${tab.slug} WHERE id = ?`).bind(id).run()).meta.changes > 0;
}

export async function counts(db: D1Database, tabs: Tab[]): Promise<number[]> {
  const results = await db.batch(tabs.map((tab) => db.prepare(`SELECT COUNT(*) AS n FROM ${tab.slug}`)));
  return results.map((r) => (r.results[0] as { n: number }).n);
}
