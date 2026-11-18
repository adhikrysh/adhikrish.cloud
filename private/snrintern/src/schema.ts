// The schema is data. A tab definition says what fields a tab's rows may hold and how its list reads.
// Definitions live in d1 (`tabs`) and change through PUT /api/_tabs/<slug>; this file only checks them.

export type FieldType = "text" | "int" | "date" | "datetime" | "url" | "enum";
export type Field = { name: string; type: FieldType; required?: boolean; min?: number; max?: number; options?: string[] };
export type TabDefinition = {
  label: string; // shown on the pages
  about: string; // one line on the home page
  title: string; // the field shown as each row's title
  aside: string[]; // fields shown at the right of a row
  line: string[]; // fields shown in the muted line under a row
  sort: string; // "id" (newest first) or a field name (descending)
  fields: Field[];
};
export type Tab = TabDefinition & { slug: string; position: number };
export type Value = string | number;
export type Data = Record<string, Value>;

export const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED = ["id", "created_at", "updated_at", "updated_by"];
const TYPES: FieldType[] = ["text", "int", "date", "datetime", "url", "enum"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// a date, optionally with a time and an offset: 2026-07-18, 2026-07-07T17:25, 2026-07-18T01:34-07:00
const DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const validDate = (s: string) => !Number.isNaN(Date.parse(s.slice(0, 10)));

/** Checks a tab definition. Returns the cleaned definition or an error message that says what to fix. */
export function checkDefinition(input: unknown): TabDefinition | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "definition must be a json object";
  const d = input as Record<string, unknown>;
  const known = new Set(["label", "about", "title", "aside", "line", "sort", "fields"]);
  for (const key of Object.keys(d)) if (!known.has(key)) return `unknown key "${key}". keys: ${[...known].join(", ")}`;
  if (typeof d.label !== "string" || !d.label.trim()) return '"label" must be a non-empty string';
  if (typeof d.about !== "string") return '"about" must be a string';
  if (!Array.isArray(d.fields) || d.fields.length === 0) return '"fields" must be a non-empty list';
  const fields: Field[] = [];
  const names = new Set<string>();
  for (const [i, raw] of d.fields.entries()) {
    if (typeof raw !== "object" || raw === null) return `fields[${i}] must be an object`;
    const f = raw as Record<string, unknown>;
    if (typeof f.name !== "string" || !FIELD_NAME.test(f.name)) return `fields[${i}].name must be lowercase snake_case, starting with a letter`;
    if (RESERVED.includes(f.name)) return `field name "${f.name}" is reserved (every row already has ${RESERVED.join(", ")})`;
    if (names.has(f.name)) return `field "${f.name}" appears twice`;
    if (!TYPES.includes(f.type as FieldType)) return `field "${f.name}": type must be one of ${TYPES.join(", ")}`;
    for (const key of Object.keys(f)) if (!["name", "type", "required", "min", "max", "options"].includes(key)) return `field "${f.name}": unknown key "${key}"`;
    const field: Field = { name: f.name, type: f.type as FieldType };
    if (f.required !== undefined) {
      if (typeof f.required !== "boolean") return `field "${f.name}": required must be true or false`;
      if (f.required) field.required = true;
    }
    if (f.min !== undefined || f.max !== undefined) {
      if (field.type !== "int") return `field "${f.name}": min and max only apply to int fields`;
      if (f.min !== undefined) { if (!Number.isInteger(f.min)) return `field "${f.name}": min must be a whole number`; field.min = f.min as number; }
      if (f.max !== undefined) { if (!Number.isInteger(f.max)) return `field "${f.name}": max must be a whole number`; field.max = f.max as number; }
    }
    if (field.type === "enum") {
      if (!Array.isArray(f.options) || f.options.length === 0 || !f.options.every((o) => typeof o === "string" && o.trim()))
        return `field "${f.name}": enum fields need "options", a list of strings`;
      field.options = f.options as string[];
    } else if (f.options !== undefined) return `field "${f.name}": options only apply to enum fields`;
    names.add(field.name);
    fields.push(field);
  }
  const title = d.title ?? fields[0].name;
  if (typeof title !== "string" || !names.has(title)) return `"title" must name one of the fields`;
  const list = (key: string, value: unknown): string[] | string => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && names.has(v))) return `"${key}" must be a list of field names`;
    return value as string[];
  };
  const aside = list("aside", d.aside);
  if (typeof aside === "string") return aside;
  const line = list("line", d.line);
  if (typeof line === "string") return line;
  const sort = d.sort ?? "id";
  if (typeof sort !== "string" || (sort !== "id" && !names.has(sort))) return `"sort" must be "id" or a field name`;
  return { label: d.label.trim(), about: d.about, title, aside, line, sort, fields };
}

/** Checks one row body against a tab's fields. `partial` is for PATCH: only the given fields are checked. */
export function checkRow(tab: Tab, body: unknown, { partial }: { partial: boolean }): { set: Data; unset: string[] } | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "body must be a json object";
  const fields = new Map(tab.fields.map((f) => [f.name, f]));
  const set: Data = {};
  const unset: string[] = [];
  for (const [name, value] of Object.entries(body)) {
    const field = fields.get(name);
    if (!field) return `unknown field "${name}". fields: ${tab.fields.map((f) => f.name).join(", ")}`;
    if (value === null || value === "") {
      if (field.required) return `"${name}" is required`;
      unset.push(name);
      continue;
    }
    const checked = checkValue(field, value);
    if (typeof checked === "object") return checked.error;
    set[name] = checked;
  }
  if (!partial) for (const f of tab.fields) if (f.required && set[f.name] === undefined) return `"${f.name}" is required`;
  if (Object.keys(set).length + unset.length === 0) return "no fields given";
  return { set, unset };
}

function checkValue(field: Field, value: unknown): Value | { error: string } {
  const fail = (what: string) => ({ error: `"${field.name}" ${what}` });
  if (field.type === "int") {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
    if (!Number.isInteger(n)) return fail("must be a whole number");
    if (field.min !== undefined && n < field.min) return fail(`must be at least ${field.min}`);
    if (field.max !== undefined && n > field.max) return fail(`must be at most ${field.max}`);
    return n;
  }
  if (typeof value !== "string" && typeof value !== "number") return fail("must be text");
  const s = String(value).trim();
  switch (field.type) {
    case "date": return DATE.test(s) && validDate(s) ? s : fail("must be a date like 2026-11-18");
    case "datetime": return DATETIME.test(s) && validDate(s) ? s : fail("must be a date or iso date-time like 2026-11-18 or 2026-11-18T09:30-08:00");
    case "url": return /^https?:\/\/\S+$/.test(s) ? s : fail("must be a url starting with http:// or https://");
    case "enum": return field.options!.includes(s) ? s : fail(`must be one of: ${field.options!.join(", ")}`);
    default: return s;
  }
}
