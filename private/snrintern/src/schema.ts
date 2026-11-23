// The schema is data. A tab definition says what fields a tab's rows may hold and how its list reads.
// Definitions live in d1 (`tabs`) and change through PUT /api/_tabs/<slug>; this file only checks them.

type FieldType = "text" | "int" | "number" | "date" | "datetime" | "url" | "enum" | "lifts";
export type Field = { name: string; type: FieldType; required?: boolean; min?: number; max?: number; unit?: string; options?: string[]; colors?: Record<string, Tone>;
  section?: string }; // section: the heading it sits under on a row's page
/** How an enum value's pill looks: white (no tone), "outline" (black with a white border), "good" (green border), "bad" (red border). */
export type Tone = "outline" | "good" | "bad";
export type TabDefinition = {
  label: string; // shown on the pages
  about: string; // one line on the home page
  title: string; // the field shown as each row's title
  aside: string[]; // fields shown at the right of a row
  line: string[]; // fields shown in the muted line under a row
  sort: string; // "id" (newest first) or a field name (descending)
  snippet?: string; // a text field previewed under each row in the list
  group?: string; // a date/datetime field groups the list by day ("wed, sep 17"); a text or enum field groups it by value
  views?: View[]; // what the tab opens on, above the list (see View)
  hidden?: boolean; // left out of the nav and home (its data still feeds other tabs' views)
  parts?: Part[]; // on a row's page: one bar per part, each field a share of it (sleep: deep, light, rem, awake)
  fields: Field[];
};

export type Part = { label: string; fields: string[] };

// A view answers one question at the top of a tab, computed from its rows (or, for "line", another tab's).
export type View =
  | { kind: "progress"; field: string } // lifts field: each exercise's top set over time
  | { kind: "strip"; field: string; label?: string; days?: number } // a tick per day with a row, from the first (at most `days` back) to today
  | { kind: "line"; field: string; tab?: string } // a number over time, from this tab or another
  | { kind: "upcoming"; field: string; where?: Record<string, string>; limit?: number } // the next rows by a date, overdue first
  | { kind: "list"; label: string; where: Record<string, string>; sort?: string; aside?: string } // the rows matching `where`, by `sort` or in the tab's order
  | { kind: "calibration"; confidence: string; verdict: string; right: string; min?: number } // how often each confidence level came true
  | { kind: "metrics"; label: string; metrics: Metric[] }; // each number's last 7 days against its usual, its best, 90 days of it
/** better: which way is good (lower resting heart rate, higher hrv). Without it a metric is never coloured and has no best. */
export type Metric = { field: string; better?: "higher" | "lower" };
export type Tab = TabDefinition & { slug: string; position: number };
export type Value = string | number;
export type Data = Record<string, Value>;

export const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED = ["id", "created_at", "updated_at", "updated_by"];
const TYPES: FieldType[] = ["text", "int", "number", "date", "datetime", "url", "enum", "lifts"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// a date, optionally with a time and an offset: 2026-07-18, 2026-07-07T17:25, 2026-07-18T01:34-07:00
const DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const validDate = (s: string) => !Number.isNaN(Date.parse(s.slice(0, 10)));

/** Checks a tab definition. Returns the cleaned definition or an error message that says what to fix. */
export function checkDefinition(input: unknown): TabDefinition | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "definition must be a json object";
  const d = input as Record<string, unknown>;
  const known = new Set(["label", "about", "title", "aside", "line", "sort", "snippet", "group", "views", "hidden", "parts", "fields"]);
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
    for (const key of Object.keys(f)) if (!["name", "type", "required", "min", "max", "unit", "options", "colors", "section"].includes(key)) return `field "${f.name}": unknown key "${key}"`;
    const field: Field = { name: f.name, type: f.type as FieldType };
    if (f.required !== undefined) {
      if (typeof f.required !== "boolean") return `field "${f.name}": required must be true or false`;
      if (f.required) field.required = true;
    }
    if (f.min !== undefined || f.max !== undefined) {
      if (field.type !== "int" && field.type !== "number") return `field "${f.name}": min and max only apply to int and number fields`;
      if (f.min !== undefined) { if (typeof f.min !== "number") return `field "${f.name}": min must be a number`; field.min = f.min as number; }
      if (f.max !== undefined) { if (typeof f.max !== "number") return `field "${f.name}": max must be a number`; field.max = f.max as number; }
    }
    if (f.unit !== undefined) {
      if (!["int", "number", "lifts"].includes(field.type)) return `field "${f.name}": unit only applies to int, number and lifts fields`;
      if (typeof f.unit !== "string" || !f.unit.trim() || f.unit.length > 12) return `field "${f.name}": unit must be a short string like "%" or "min"`;
      field.unit = f.unit;
    }
    if (field.type === "enum") {
      if (!Array.isArray(f.options) || f.options.length === 0 || !f.options.every((o) => typeof o === "string" && o.trim()))
        return `field "${f.name}": enum fields need "options", a list of strings`;
      field.options = f.options as string[];
      if (f.colors !== undefined) {
        const c = f.colors as Record<string, unknown>;
        if (typeof c !== "object" || c === null || !Object.entries(c).every(([k, v]) => field.options!.includes(k) && (v === "outline" || v === "good" || v === "bad")))
          return `field "${f.name}": colors maps options to "outline", "good" or "bad", e.g. { "closed": "outline", "right": "good" }`;
        field.colors = c as Record<string, Tone>;
      }
    } else if (f.options !== undefined || f.colors !== undefined) return `field "${f.name}": options and colors only apply to enum fields`;
    if (f.section !== undefined) {
      if (typeof f.section !== "string" || !f.section.trim()) return `field "${f.name}": section must be a heading like "sleep"`;
      field.section = f.section;
    }
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
  const types = new Map(fields.map((f) => [f.name, f.type]));
  let snippet: string | undefined;
  if (d.snippet !== undefined) {
    if (typeof d.snippet !== "string" || types.get(d.snippet) !== "text") return `"snippet" must name a text field`;
    snippet = d.snippet;
  }
  let group: string | undefined;
  if (d.group !== undefined) {
    if (typeof d.group !== "string" || !["date", "datetime", "enum", "text"].includes(types.get(d.group) ?? "")) return `"group" must name a date, datetime, text or enum field`;
    group = d.group;
  }
  const views = checkViews(d.views, types);
  if (typeof views === "string") return views;
  if (d.hidden !== undefined && typeof d.hidden !== "boolean") return `"hidden" must be true or false`;
  const parts: Part[] = [];
  if (d.parts !== undefined) {
    if (!Array.isArray(d.parts)) return '"parts" must be a list';
    for (const [i, raw] of d.parts.entries()) {
      const p = raw as Record<string, unknown>;
      if (typeof p !== "object" || p === null || typeof p.label !== "string" || !p.label.trim() || !Array.isArray(p.fields) || p.fields.length < 2
        || !p.fields.every((n) => typeof n === "string" && ["int", "number"].includes(types.get(n) ?? ""))) return `parts[${i}]: needs a "label" and two or more number "fields"`;
      parts.push({ label: p.label, fields: p.fields as string[] });
    }
  }
  return { label: d.label.trim(), about: d.about, title, aside, line, sort, ...(snippet ? { snippet } : {}),
    ...(group ? { group } : {}), ...(views.length ? { views } : {}), ...(d.hidden ? { hidden: true } : {}), ...(parts.length ? { parts } : {}), fields };
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

function checkViews(input: unknown, types: Map<string, FieldType>): View[] | string {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return '"views" must be a list';
  const views: View[] = [];
  for (const [i, raw] of input.entries()) {
    if (typeof raw !== "object" || raw === null) return `views[${i}] must be an object`;
    const v = raw as Record<string, any>;
    const where = `views[${i}] (${v.kind})`;
    const isField = (name: unknown, allowed: FieldType[]) => typeof name === "string" && allowed.includes(types.get(name)!);
    switch (v.kind) {
      case "progress": if (!isField(v.field, ["lifts"])) return `${where}: "field" must name a lifts field`; break;
      case "strip":
        if (!isField(v.field, ["date", "datetime"])) return `${where}: "field" must name a date field`;
        if (v.label !== undefined && (typeof v.label !== "string" || !v.label.trim())) return `${where}: "label" must be a word like "sessions"`;
        if (v.days !== undefined && (!Number.isInteger(v.days) || v.days < 7 || v.days > 366)) return `${where}: "days" must be a whole number from 7 to 366`;
        break;
      case "line":
        if (typeof v.field !== "string" || (v.tab === undefined && !isField(v.field, ["number", "int"]))) return `${where}: "field" must name a number field (or set "tab" for another tab's field)`;
        if (v.tab !== undefined && !SLUG.test(v.tab)) return `${where}: "tab" must be a tab slug`;
        break;
      case "upcoming":
        if (!isField(v.field, ["date", "datetime"])) return `${where}: "field" must name a date field`;
        if (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 20)) return `${where}: "limit" must be a whole number from 1 to 20`;
        break;
      case "calibration": if (!isField(v.confidence, ["int", "number"]) || !isField(v.verdict, ["enum"]) || typeof v.right !== "string") return `${where}: needs a number "confidence", an enum "verdict" and the "right" value`; break;
      case "list":
        if (typeof v.label !== "string" || !v.label.trim()) return `${where}: "label" must be a heading like "reading"`;
        if (typeof v.where !== "object" || v.where === null || Array.isArray(v.where) || !Object.keys(v.where).length
          || Object.entries(v.where).some(([k, val]) => !types.has(k) || typeof val !== "string")) return `${where}: "where" must map fields to values, like { "status": "reading" }`;
        if (v.sort !== undefined && !types.has(v.sort)) return `${where}: "sort" must name a field`;
        if (v.aside !== undefined && !types.has(v.aside)) return `${where}: "aside" must name a field`;
        break;
      case "metrics":
        if (typeof v.label !== "string" || !v.label.trim()) return `${where}: "label" must be a heading like "sleep"`;
        if (!Array.isArray(v.metrics) || !v.metrics.length || !v.metrics.every((m: any) => typeof m === "object" && m !== null
          && isField(m.field, ["int", "number"]) && (m.better === undefined || m.better === "higher" || m.better === "lower")))
          return `${where}: "metrics" must list { "field": <a number field>, "better": "higher" or "lower" (optional) }`;
        break;
      default: return `views[${i}]: kind must be one of progress, strip, line, upcoming, calibration, list, metrics`;
    }
    views.push(v as View);
  }
  return views;
}

// lifts: "flat db press: 45x10, 50x8, 60x6; pull up: bwx10, +25x4" (weights in the field's unit, lb unless set).
// bw = bodyweight, +25 = bodyweight plus 25, 50x8x3 = three sets of 50x8.
type LiftSet = { load: number | null; added: boolean; reps: number };
type Lift = { exercise: string; sets: LiftSet[] };
const SET = /^(bw|\+?\d+(?:\.\d+)?)\s*x\s*(\d+)(?:\s*x\s*(\d+))?$/;

/** Parses and normalizes a lifts value. Returns the lifts, or an error saying what is wrong. */
export function parseLifts(text: string): Lift[] | string {
  const lifts: Lift[] = [];
  for (const part of text.replaceAll("×", "x").split(";").map((p) => p.trim()).filter(Boolean)) {
    const colon = part.indexOf(":");
    if (colon < 1) return `"${part.slice(0, 30)}" needs "exercise: sets"`;
    const exercise = part.slice(0, colon).trim().toLowerCase().replace(/\s+/g, " ");
    if (!/^[a-z0-9][a-z0-9 ()'\/-]*$/.test(exercise)) return `exercise "${exercise}" may only use letters, digits, spaces and ()'/-`;
    const sets: LiftSet[] = [];
    for (const raw of part.slice(colon + 1).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      const m = SET.exec(raw);
      if (!m) return `"${raw}" in ${exercise} must look like 50x8, bwx10, +25x6 or 50x8x3`;
      const load = m[1] === "bw" ? null : Number(m[1].replace("+", ""));
      for (let i = 0; i < Number(m[3] ?? 1); i++) sets.push({ load, added: m[1].startsWith("+"), reps: Number(m[2]) });
    }
    if (!sets.length) return `${exercise} has no sets`;
    lifts.push({ exercise, sets });
  }
  return lifts.length ? lifts : "no exercises given";
}

const formatLifts = (lifts: Lift[]) =>
  lifts.map((l) => `${l.exercise}: ${l.sets.map((s) => `${s.load === null ? "bw" : (s.added ? "+" : "") + s.load}x${s.reps}`).join(", ")}`).join("; ");

function checkValue(field: Field, value: unknown): Value | { error: string } {
  const fail = (what: string) => ({ error: `"${field.name}" ${what}` });
  if (field.type === "int" || field.type === "number") {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
    if (field.type === "int" && !Number.isInteger(n)) return fail("must be a whole number");
    if (!Number.isFinite(n)) return fail("must be a number");
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
    case "lifts": { const lifts = parseLifts(s); return typeof lifts === "string" ? fail(`is not valid: ${lifts}`) : formatLifts(lifts); }
    default: return s;
  }
}
