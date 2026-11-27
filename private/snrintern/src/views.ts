// Views: what a tab opens on, above its list. Each answers one question from the rows, configured in the
// tab definition (`views`), so a tab added later can use them too. A view with nothing to say renders nothing.
// Charts are small inline svgs; green is good, red is bad, everything else is grey.
// Each view computes once and returns both its numbers (`data`, served as json at /api/<tab>/_views for the agents) and its
// html (the page), built from the same values, so what an agent reads and what the page shows can't disagree.
import { escape } from "../../../design/html.ts";
import { chart, type ChartPoint, type ChartStream } from "./charts.ts";
import * as db from "./db.ts";
import { graphBox } from "./graph.ts";
import { graph } from "./refs.ts";
import { parseLifts, type Field, type Metric, type Tab, type View } from "./schema.ts";

export const VIEW_CSS = `
  .views { margin-top: 32px; display: grid; gap: 40px; }
  .view h2 { line-height: 1; margin-bottom: 14px; }
  .view .big { font-size: var(--fs-title); color: var(--bright); letter-spacing: -0.02em; line-height: 1.2; }
  .view .sub { color: var(--muted); font-size: var(--fs-small); margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .view a { color: inherit; }
  .strip-head { display: flex; justify-content: space-between; align-items: baseline; }
  .strip-head h2 { margin-bottom: 14px; }
  .strip-head > span { color: var(--muted); font-size: var(--fs-small); }
  .strip { display: flex; gap: 1px; }
  .strip i { flex: 1; height: 22px; border-radius: 1px; background: var(--line); }
  .strip i.up { background: var(--good); }
  .strip-ends { display: flex; justify-content: space-between; color: var(--faint); font-size: var(--fs-tiny); margin-top: 6px; }
  .lifts { display: grid; gap: 16px; }
  .lift { display: grid; grid-template-columns: minmax(0, 1fr) 120px; column-gap: 16px; align-items: center; }
  .lift .name { color: var(--bright); }
  .lift .sub { grid-column: 1; margin-top: 2px; }
  .lift svg.box { grid-column: 2; grid-row: 1 / span 2; }
  .rowlist { list-style: none; display: grid; gap: 10px; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 24px; margin: 0; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; }
  .rowlist li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: baseline; }
  .rowlist small { color: var(--muted); font-size: var(--fs-tiny); white-space: nowrap; }
  .rowlist small.good { color: var(--good); } .rowlist small.bad { color: var(--bad); }
  .metrics { display: grid; gap: 22px; }
  .metric { display: grid; grid-template-columns: minmax(0, 1fr) auto 120px; grid-template-rows: auto auto; column-gap: 16px; align-items: baseline; color: inherit; text-decoration: none; }
  .metric .name { color: var(--bright); }
  a.metric .name { text-decoration: underline; text-underline-offset: 2px; }
  a.metric:hover .name { color: var(--hover); }
  .metric .val { color: var(--bright); text-align: right; white-space: nowrap; }
  .metric .val.good, .metric .why .good { color: var(--good); } .metric .val.bad, .metric .why .bad { color: var(--bad); }
  .metric .why { grid-column: 1 / span 2; color: var(--muted); font-size: var(--fs-small); display: flex; flex-wrap: wrap; gap: 2px 14px; margin-top: 2px; }
  svg.box { grid-column: 3; grid-row: 1 / span 2; align-self: center; width: 120px; height: 36px; overflow: visible; }
  svg.box .usual { fill: var(--muted); opacity: 0.28; }
  svg.box polyline { fill: none; stroke: var(--text); stroke-width: 1.2; stroke-linejoin: round; }
  svg.box circle { fill: var(--text); } svg.box circle.today { fill: var(--bright); }
  svg.box circle.today.good { fill: var(--good); } svg.box circle.today.bad { fill: var(--bad); }
`;

const DAY = 86_400_000;
const today = () => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };
const dayOf = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const short = (t: number) => { const d = new Date(t); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
function ago(t: number): string {
  const days = Math.round((t - today()) / DAY);
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  const n = Math.abs(days);
  const [c, u] = n < 14 ? [n, "day"] : n < 60 ? [Math.round(n / 7), "week"] : n < 730 ? [Math.round(n / 30.44), "month"] : [Math.round(n / 365.25), "year"];
  const span = `${c} ${u}${c === 1 ? "" : "s"}`;
  return days < 0 ? `${span} ago` : `in ${span}`;
}


type Ctx = { tab: Tab; rows: db.Row[]; database: D1Database; recent: () => Promise<db.Row[]> };
const dateField = (tab: Tab) => (tab.sort !== "id" ? tab.sort : tab.group ?? "created_at");
const title = (tab: Tab, row: db.Row) => escape(row[tab.title] ?? "untitled");
// every view is headed by a white pill, the way admin labels its sections
const pill = (heading: string) => `<h2><span class="pill">${escape(heading)}</span></h2>`;
const section = (heading: string, body: string) => `<section class="view">${pill(heading)}${body}</section>`;
/** A view's answer: its numbers for the api and its html for the page. */
export type ViewResult = { kind: View["kind"]; label: string; data: Record<string, unknown>; html: string; page?: boolean };
const result = (kind: View["kind"], label: string, data: Record<string, unknown>, body: string): ViewResult => ({ kind, label, data, html: section(label, body) });

type Point = { t: number; top: number; reps: number; label: string; sets: string[]; row: db.Row };
const setLabel = (s: { load: number | null; added: boolean; reps: number }, bodyweight: boolean, unit: string) =>
  s.load === null ? `bw × ${s.reps}` : `${bodyweight ? "+" : ""}${fmt(s.load)}${bodyweight ? "" : ` ${unit}`} × ${s.reps}`;

/** Every exercise's sessions in date order: the best set (bodyweight work counts added weight, bw = 0) and all sets. */
function liftSeries(tab: Tab, rows: db.Row[], field: string): Map<string, Point[]> {
  const unit = tab.fields.find((f) => f.name === field)?.unit ?? "lb";
  const series = new Map<string, Point[]>();
  for (const row of rows) {
    const t = dayOf(row[dateField(tab)]);
    const lifts = typeof row[field] === "string" ? parseLifts(String(row[field])) : [];
    if (t === null || typeof lifts === "string") continue;
    for (const lift of lifts) {
      const bodyweight = lift.sets.some((s) => s.load === null || s.added);
      const load = (s: (typeof lift.sets)[number]) => s.load ?? 0;
      const best = lift.sets.reduce((a, s) => (load(s) > load(a) || (load(s) === load(a) && s.reps > a.reps) ? s : a));
      series.set(lift.exercise, [...(series.get(lift.exercise) ?? []),
        { t, top: load(best), reps: best.reps, label: setLabel(best, bodyweight, unit), sets: lift.sets.map((s) => setLabel(s, bodyweight, unit)), row }]);
    }
  }
  for (const pts of series.values()) pts.sort((a, b) => a.t - b.t);
  return series;
}

/** Values as dots joined by a line in a small box, evenly spaced, the last one white: the shape of a recent run at a glance. */
function dotBox(values: number[]): string {
  const W = 120, H = 36, P = 4, lo = Math.min(...values), hi = Math.max(...values), range = hi - lo || 1;
  const X = (i: number) => (values.length === 1 ? W / 2 : P + (i / (values.length - 1)) * (W - 2 * P)), Y = (y: number) => (hi === lo ? H / 2 : P + (1 - (y - lo) / range) * (H - 2 * P));
  const line = values.length > 1 ? `<polyline points="${values.map((y, i) => `${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")}"/>` : "";
  return `<svg class="box" viewBox="0 0 ${W} ${H}" aria-hidden="true">${line}${values.map((y, i) => `<circle${i === values.length - 1 ? ' class="today"' : ""} cx="${X(i).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="${i === values.length - 1 ? 3.5 : 2}"/>`).join("")}</svg>`;
}

/** Each exercise done on 2+ days: its best set over time, linking to its own page. */
function progress(v: Extract<View, { kind: "progress" }>, { tab, rows }: Ctx): ViewResult | null {
  const series = liftSeries(tab, rows, v.field);
  const items = [...series].map(([name, pts]) => ({ name, pts })).filter((s) => s.pts.length >= 2)
    .sort((a, b) => b.pts.at(-1)!.t - a.pts.at(-1)!.t);
  if (!items.length) return null;
  const exercises: Record<string, unknown>[] = [];
  const html = items.map(({ name, pts }) => {
    const first = pts[0], last = pts.at(-1)!;
    const best = pts.reduce((a, p) => (p.top > a.top || (p.top === a.top && p.reps > a.reps) ? p : a));
    // green: the latest session is the best and beats the first. red: the latest is below the best.
    const tone = last === best && last.top > first.top ? "good" : last.top < best.top ? "bad" : "";
    const latest = last === best ? "" : `<span>latest ${escape(last.label)}</span>`;
    // the box on the right, like a health row: one dot per session (the last 14), the latest in white
    const href = `/${tab.slug}/lifts/${encodeURIComponent(name)}`;
    exercises.push({ exercise: name, best: best.label, best_on: isoDay(best.t), latest: last.label, latest_on: isoDay(last.t), sessions: pts.length,
      trend: tone === "good" ? "new best" : tone === "bad" ? "below best" : "steady" });
    return `<div class="lift"><a class="name" href="${href}">${escape(name)}</a><span class="sub"><span class="${tone}">best ${escape(best.label)}</span>${latest}</span>${dotBox(pts.slice(-14).map((p) => p.top))}</div>`;
  });
  return result("progress", "progress", { exercises }, `<div class="lifts">${html.join("")}</div>`);
}

/** One tick per day from the first row (at most `days` back, default 182) to today, green on days that have a row; how many a week,
 * and how long since the last, red once this gap is longer than any gap between earlier rows (your own history, no fixed number).
 * `label` is the heading ("sessions"); the last line uses it without the s. */
function strip(v: Extract<View, { kind: "strip" }>, { rows }: Ctx): ViewResult | null {
  const now = today();
  const dated = rows.map((r) => dayOf(r[v.field])).filter((d): d is number => d !== null && d <= now);
  if (!dated.length) return null;
  const days = new Set(dated), sorted = [...days].sort((a, b) => a - b), last = sorted.at(-1)!;
  const longest = sorted.slice(1).reduce((gap, t, i) => Math.max(gap, t - sorted[i]), 0);
  const start = Math.max(Math.min(...dated), now - ((v.days ?? 182) - 1) * DAY);
  const ticks: string[] = [];
  for (let t = start; t <= now; t += DAY) ticks.push(`<i class="${days.has(t) ? "up" : ""}" title="${short(t)}"></i>`);
  const perWeek = dated.filter((d) => d >= start).length / Math.max(1, (now - start + DAY) / (7 * DAY));
  const heading = v.label ?? "entries", late = sorted.length > 1 && now - last > longest;
  const html = `<section class="view"><div class="strip-head">${pill(heading)}<span>${fmt(Math.round(perWeek * 10) / 10)} a week</span></div>
<div class="strip">${ticks.join("")}</div><div class="strip-ends"><span>${short(start)}</span><span>today</span></div>
<p class="sub"><span class="${late ? "bad" : ""}">last ${escape(heading.replace(/s$/, ""))} ${ago(last)}</span></p></section>`;
  return { kind: "strip", label: heading, html, data: { per_week: Math.round(perWeek * 10) / 10, since: isoDay(start), last: isoDay(last),
    days_since_last: Math.round((now - last) / DAY), longest_gap_days: Math.round(longest / DAY), longer_gap_than_ever: late } };
}

/** Chart points, one per day (a day with two rows keeps the later). */
function perDay(pts: { t: number; y: number; id: number }[]): ChartPoint[] {
  const byDay = new Map<string, ChartPoint>();
  for (const p of pts) { const d = new Date(p.t).toISOString().slice(0, 10); byDay.set(d, [d, p.y, p.id]); }
  return [...byDay.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** A number over time: the latest, the change since the first, and a line. `tab` reads another tab's rows. No targets: it shows what happened. */
async function line(v: Extract<View, { kind: "line" }>, { tab, rows, database }: Ctx): Promise<ViewResult | null> {
  const source = v.tab ? await db.tab(database, v.tab) : tab;
  if (!source) return null;
  const sourceRows = v.tab ? await db.list(database, source) : rows;
  const unit = source.fields.find((f) => f.name === v.field)?.unit;
  const u = unit ? (unit === "%" ? "%" : ` ${unit}`) : "";
  const pts = sourceRows.map((row) => ({ t: dayOf(row[dateField(source)]), y: Number(row[v.field]), id: row.id }))
    .filter((p): p is { t: number; y: number; id: number } => p.t !== null && Number.isFinite(p.y) && p.y !== 0).sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  const first = pts[0], last = pts.at(-1)!, change = last.y - first.y;
  const sub = pts.length > 1 ? `<span>${change >= 0 ? "+" : ""}${fmt(change)}${u} since ${short(first.t)}</span>` : `<span>${short(last.t)}</span>`;
  // every day since the first, zoomable; a dot opens that day's row
  const plot = pts.length > 1 ? chart({ points: perDay(pts), base: `/${source.slug}/`, unit, int: source.fields.find((f) => f.name === v.field)?.type === "int" }) : "";
  const name = v.field.replaceAll("_", " ").replace(/ (kg|lb|percentage|cm)$/, "");
  return result("line", name, { field: v.field, tab: source.slug, unit: unit ?? null, latest: last.y, on: isoDay(last.t), first: first.y, since: isoDay(first.t), change: Math.round(change * 10) / 10 },
    `<p class="big">${fmt(last.y)}${escape(u)}</p><p class="sub">${sub}</p>${plot}`);
}

/** Does a row match a view's `where` (every key equal)? */
export const matches = (where: Record<string, string> | undefined, row: db.Row) => Object.entries(where ?? {}).every(([k, val]) => row[k] === val);

/** The next `limit` (default 3) rows matching `where`, soonest first; a date already past is overdue, in red. */
function upcoming(v: Extract<View, { kind: "upcoming" }>, { tab, rows }: Ctx): ViewResult | null {
  const now = today();
  const next = rows.filter((row) => matches(v.where, row)).map((row) => ({ row, t: dayOf(row[v.field]) }))
    .filter((x): x is { row: db.Row; t: number } => x.t !== null).sort((a, b) => a.t - b.t).slice(0, v.limit ?? 3);
  if (!next.length) return null;
  const html = next.map(({ row, t }) => `<li><a href="/${tab.slug}/${row.id}">${title(tab, row)}</a><small class="${t < now ? "bad" : ""}">${t < now ? `overdue ${ago(t).replace(" ago", "")}` : ago(t)}</small></li>`);
  return result("upcoming", "upcoming", { rows: next.map(({ row, t }) => ({ id: row.id, title: row[tab.title] ?? null, date: isoDay(t), overdue: t < now })) },
    `<ul class="rowlist">${html.join("")}</ul>`);
}

/** The rows matching `where`, headed by `label`: largest `sort` first (empty last, then the tab's order), or the tab's order; `aside` shows one field at the right (a date as "2 weeks ago").
 * No dates are judged here: a book on the reading list for a year is not overdue. */
function list(v: Extract<View, { kind: "list" }>, { tab, rows }: Ctx): ViewResult | null {
  const key = (row: db.Row) => (v.sort && row[v.sort] !== undefined && row[v.sort] !== "" ? String(row[v.sort]) : null);
  const matching = rows.filter((row) => matches(v.where, row));
  if (v.sort) matching.sort((a, b) => { const x = key(a), y = key(b); return x === y ? 0 : x === null ? 1 : y === null ? -1 : y.localeCompare(x, undefined, { numeric: true }); });
  if (!matching.length) return null;
  const type = tab.fields.find((f) => f.name === v.aside)?.type;
  const aside = (row: db.Row) => {
    if (!v.aside || row[v.aside] === undefined || row[v.aside] === "") return "";
    const t = type === "date" || type === "datetime" ? dayOf(row[v.aside]) : null;
    return `<small>${t !== null ? ago(t) : escape(row[v.aside])}</small>`;
  };
  const html = matching.map((row) => `<li><a href="/${tab.slug}/${row.id}">${title(tab, row)}</a>${aside(row)}</li>`);
  return result("list", v.label, { rows: matching.map((row) => ({ id: row.id, title: row[tab.title] ?? null, ...(v.aside ? { [v.aside]: row[v.aside] ?? null } : {}) })) },
    `<ul class="rowlist">${html.join("")}</ul>`);
}

// ---- metrics: numbers that come every day (health) ----
//
// A metric row is a verdict and its evidence: one short phrase judging one day, and a box of the last 14 days. The phrase
// comes from the closest thing to a source of truth (see Metric in schema.ts): garmin's own word for the day, garmin's
// published bands, garmin's goal, and only where garmin has nothing, your own history (higher or lower than 80% of the 28
// days before). Fixed rules, no model: no cost, and the same numbers always read the same. Green is good, red is bad.

const RECENT = 125; // rows a metrics view reads: 90 days for "highest in 3 months", 28 for the band, 7 to spare
const BOX = 14; // days in a row's box
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A value in its unit, as precise as the field: whole numbers for int fields, one decimal otherwise; minutes past an hour read "7h 40m". */
export function amount(f: Field | undefined, v: number): string {
  if (f?.unit === "s" && Math.abs(v) >= 60) { // a time: 28:22, 1:02:05
    const t = Math.round(Math.abs(v)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0");
    return `${v < 0 ? "-" : ""}${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${sec}`;
  }
  if (f?.unit === "min" && Math.abs(v) >= 60) return `${Math.floor(Math.abs(v) / 60) * Math.sign(v)}h${Math.round(Math.abs(v) % 60) ? ` ${Math.round(Math.abs(v) % 60)}m` : ""}`;
  const n = Math.abs(v) >= 100 || f?.type === "int" ? Math.round(v).toLocaleString("en-US") : fmt(Math.round(v * 10) / 10);
  return f?.unit ? `${n}${f.unit === "%" ? "" : " "}${f.unit}` : n;
}
/** "resting_hr" -> "resting hr", "hrv_ms" -> "hrv": the unit is shown with the value. */
export const metricName = (name: string) => name.replace(/_(ms|min|kg|km|bpm|s|m)$/, "").replaceAll("_", " ");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const finite = (y: number) => Number.isFinite(y);
type Pt = { t: number; y: number };
/** The q-th quantile (0..1) of numbers, interpolated. */
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}
/** Minutes after 6pm, so bedtimes either side of midnight compare as one line (11pm = 300, 1am = 420). */
export type Verdict = { day: db.Row; value: number; word: string; tone: "" | "good" | "bad"; band: [number, number] | null; box: { t: number; y: number }[]; soFar?: number };

/** Judges one metric's newest day (or newest finished day), or the day `on`, by the first rule it has. rows: oldest first. */
export function judge(tab: Tab, m: Metric, rows: db.Row[], newestDate: string | null, on?: string): Verdict | null {
  const dateF = dateField(tab), f = tab.fields.find((x) => x.name === m.field);
  const pts = rows.map((r) => ({ t: dayOf(r[dateF]), y: Number(r[m.field]), row: r })).filter((p): p is Pt & { row: db.Row } => p.t !== null && r0(p.row[m.field]) && finite(p.y));
  if (!pts.length) return null;
  let at = pts.length - 1, soFar: number | undefined;
  if (on !== undefined) { at = pts.findIndex((p) => String(p.row[dateF]).slice(0, 10) === on); if (at < 0) return null; }
  else if (m.finished && pts.length > 1 && String(pts[at].row[dateF]) === liveDay(newestDate)) { soFar = pts[at].y; at--; } // today isn't done: judge yesterday
  const day = pts[at];
  let value = day.y, word = "", tone: Verdict["tone"] = "", band: [number, number] | null = null;
  const label = m.label ? String(day.row[m.label.field] ?? "") : "";
  if (m.label && label) { // garmin's own word
    word = label;
    tone = m.label.good?.includes(label) ? "good" : m.label.bad?.includes(label) ? "bad" : "";
  } else if (m.scale) { // garmin's bands
    const b = m.scale.find((x) => day.y <= x.upTo) ?? m.scale.at(-1)!;
    word = b.word; tone = b.tone ?? "";
  } else if (m.goal) { // garmin's goal, for the day or the week ending it
    const goal = Number(day.row[m.goal]);
    if (m.per === "week") value = pts.filter((p) => p.t <= day.t && p.t > day.t - 7 * DAY).reduce((sum, p) => sum + p.y, 0);
    if (finite(goal) && goal > 0) {
      word = m.per === "week" ? `${Math.round(value)} of ${Math.round(goal)}${f?.unit ? ` ${f.unit}` : ""} this week` : value >= goal ? "goal met" : `${amount(f, goal - value)} short of goal`;
      if (value >= goal) tone = "good";
    }
  } else if (m.change) { // a slow number: how it moved
    const old = pts.filter((p) => p.t <= day.t - 60 * DAY).at(-1);
    if (old) {
      const d = day.y - old.y, months = Math.max(2, Math.round((day.t - old.t) / (30.44 * DAY))), still = Math.abs(d) < (f?.type === "int" ? 1 : 0.1);
      word = still ? `no change in ${months} months` : `${d > 0 ? "up" : "down"} ${amount(f, Math.abs(d))} in ${months} months`;
      if (m.better && !still) tone = (d > 0) === (m.better === "higher") ? "good" : "bad";
    }
  } else { // your own history, and a clinical bound if there is one
    const before = pts.filter((p) => p.t < day.t && p.t >= day.t - 28 * DAY).map((p) => p.y);
    if (before.length >= 14) band = [quantile(before, 0.1), quantile(before, 0.9)];
    if (m.limit !== undefined && day.y > m.limit) { word = `above ${amount(f, m.limit)}`; tone = "bad"; }
    else if (band && day.y > band[1]) { word = "higher than usual"; tone = m.better ? (m.better === "higher" ? "good" : "bad") : ""; }
    else if (band && day.y < band[0]) { word = "lower than usual"; tone = m.better ? (m.better === "lower" ? "good" : "bad") : ""; }
    else if (band) word = "usual";
  }
  const box = pts.filter((p) => p.t <= day.t && p.t > day.t - BOX * DAY).map((p) => ({ t: p.t, y: p.y }));
  return { day: day.row, value, word, tone, band, box, soFar };
}
const r0 = (v: unknown) => v !== undefined && v !== null && v !== "";
/** The newest date if it is today where you are (garmin's dates are local, so today or yesterday in utc), else null: a tab that
 * hasn't synced for days has no "today", so nothing reads as today, yesterday or "so far". */
const liveDay = (d: string | null) => (d !== null && (dayOf(d) ?? 0) >= today() - DAY ? d : null);

/**
 * A day's big picture in a few words: each metric with `log` words is judged on that day, and the ones judged good or bad
 * give their words, bad first, at most two, repeats merged ("well recovered" from both hrv and resting hr counts once).
 * Nothing outside usual: "an ordinary day". Today's tallies aren't finished, so they say nothing yet. rows: oldest first,
 * including the 28 days before `date`.
 */
export function dayWords(tab: Tab, rows: db.Row[], date: string, newestDate: string | null): { text: string; tone: "" | "good" | "bad" }[] {
  const out: { text: string; tone: "good" | "bad" }[] = [];
  for (const m of tab.views?.flatMap((v) => (v.kind === "metrics" ? v.metrics : [])) ?? []) {
    if ((!m.log?.good && !m.log?.bad) || m.change || (m.finished && date === liveDay(newestDate))) continue;
    const v = judge(tab, m, rows, newestDate, date);
    const text = v?.tone === "good" ? m.log?.good : v?.tone === "bad" ? m.log?.bad : undefined;
    if (text && v && !out.some((o) => o.text === text)) out.push({ text, tone: v.tone as "good" | "bad" });
  }
  out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "bad" ? -1 : 1));
  return out.length ? out.slice(0, 2) : [{ text: "an ordinary day", tone: "" }];
}

/** A row's box: its last 14 days as dots joined by a line, on a scale fitted to them and the band, the band shaded, the judged
 * day white (or green / red with the words). A gap of more than 2 days (watch off) leaves the line open. Static svg: the box
 * is evidence to glance at; the full page is where you explore. */
function box(v: Verdict, end: number): string {
  const W = 120, H = 36, P = 4, ys = [...v.box.map((p) => p.y), ...(v.band ?? [])];
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi === lo) { lo -= 1; hi += 1; }
  const X = (t: number) => P + ((t - (end - (BOX - 1) * DAY)) / ((BOX - 1) * DAY)) * (W - 2 * P), Y = (y: number) => P + (1 - (y - lo) / (hi - lo)) * (H - 2 * P);
  const band = v.band ? `<rect class="usual" x="0" y="${Y(v.band[1]).toFixed(1)}" width="${W}" height="${Math.max(1, Y(v.band[0]) - Y(v.band[1])).toFixed(1)}"/>` : "";
  const dots = v.box.map((p, i) => i === v.box.length - 1
    ? `<circle class="today${v.tone ? ` ${v.tone}` : ""}" cx="${X(p.t).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.5"/>`
    : `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2"/>`).join("");
  const runs: { t: number; y: number }[][] = [];
  for (const p of v.box) { const last = runs.at(-1)?.at(-1); if (!last || p.t - last.t > 2 * DAY) runs.push([p]); else runs.at(-1)!.push(p); }
  const lines = runs.filter((r) => r.length > 1).map((r) => `<polyline points="${r.map((p) => `${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}"/>`).join("");
  return `<svg class="box" viewBox="0 0 ${W} ${H}" aria-hidden="true">${band}${lines}${dots}</svg>`;
}

/** Each metric as one line: its name and the judged day's value, the words under them, the 14-day box on the right.
 * The whole row opens the metric's full page. */
async function metrics(v: Extract<View, { kind: "metrics" }>, { tab, recent }: Ctx): Promise<ViewResult | null> {
  const rows = await recent(), dateF = dateField(tab);
  const newestDate = rows.length ? String(rows.at(-1)![dateF]) : null, newestT = newestDate ? dayOf(newestDate) : null;
  const data: Record<string, unknown>[] = [];
  const items = v.metrics.map((m) => {
    const f = tab.fields.find((x) => x.name === m.field), verdict = judge(tab, m, rows, newestDate);
    if (!verdict) return "";
    const t = dayOf(verdict.day[dateF])!;
    const live = liveDay(newestDate) ? newestT : null;
    const when = live === null ? short(t) : t === live ? "today" : t === live - DAY ? "yesterday" : short(t);
    const words = [...(verdict.word ? [`<span${verdict.tone ? ` class="${verdict.tone}"` : ""}>${escape(verdict.word)}</span>`] : []),
      `<span>${escape(when)}</span>`, ...(verdict.soFar !== undefined ? [`<span>today so far ${escape(amount(f, verdict.soFar))}</span>`] : [])];
    const shown = m.per === "week" ? `${Math.round(verdict.value)}${f?.unit ? ` ${f.unit}` : ""}` : amount(f, verdict.value);
    data.push({ field: m.field, name: metricName(m.field), value: verdict.value, shown, verdict: verdict.word || null, tone: verdict.tone || null,
      day: String(verdict.day[dateF]).slice(0, 10), when, ...(m.per === "week" ? { per: "week" } : {}),
      ...(verdict.soFar !== undefined ? { today_so_far: verdict.soFar } : {}), ...(verdict.band ? { usual: verdict.band.map((x) => Math.round(x * 10) / 10) } : {}) });
    return `<a class="metric" href="/${tab.slug}/metrics/${m.field}"><span class="name">${escape(metricName(m.field))}</span><span class="val${verdict.tone ? ` ${verdict.tone}` : ""}">${escape(m.per === "week" ? `${Math.round(verdict.value)}${f?.unit ? ` ${f.unit}` : ""}` : amount(f, verdict.value))}</span><span class="why">${words.join("")}</span>${verdict.box.length > 1 ? box(verdict, t) : "<span></span>"}</a>`;
  }).filter(Boolean);
  return items.length ? result("metrics", v.label, { metrics: data }, `<div class="metrics">${items.join("")}</div>`) : null;
}

const STREAM_DAYS = 3; // the newest days whose streams a full page carries (1d, 3d)

/** One metric's full page: its streams first (1d, 3d) when it has them, then every day since the first as dots on a scale
 * fitted to them; your usual band as two dashed lines; the best week in green; the last two weeks listed, each opening its day. */
export async function metricPage(tab: Tab, database: D1Database, name: string): Promise<string | null> {
  const metric = tab.views?.flatMap((v) => (v.kind === "metrics" ? v.metrics : [])).find((m) => m.field === name);
  const f = tab.fields.find((x) => x.name === name);
  if (!metric || !f) return null;
  const [entries, recentStreams, recentRows] = await Promise.all([db.history(database, tab, dateField(tab), [name]),
    metric.stream ? db.recentSeries(database, tab.slug, dateField(tab), STREAM_DAYS) : Promise.resolve([]),
    db.since(database, tab, dateField(tab), isoDay(today() - (RECENT - 1) * DAY))]);
  const pts = entries.map((h) => ({ t: dayOf(h.date), y: Number(h.values[0]), id: h.id })).filter((p): p is { t: number; y: number; id: number } => p.t !== null && finite(p.y));
  const head = `<h1>${escape(metricName(name))}</h1>`;
  if (!pts.length) return `${head}<p class="lift-best">nothing yet</p>`;
  const verdict = judge(tab, metric, recentRows, recentRows.length ? String(recentRows.at(-1)![dateField(tab)]) : null);
  let best: { from: number; to: number; avg: number } | null = null;
  if (metric.better) { // the seven days with a value whose average is best; fewer than seven, the best day
    const n = Math.min(7, pts.length), better = (a: number, b: number) => (metric.better === "higher" ? a > b : a < b);
    for (let i = n - 1; i < pts.length; i++) {
      const avg = mean(pts.slice(i - n + 1, i + 1).map((p) => p.y));
      if (!best || better(avg, best.avg)) best = { from: i - n + 1, to: i, avg };
    }
  }
  const week = best ? pts.slice(best.from, best.to + 1) : [];
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const byDay = new Map<string, ChartPoint>();
  for (const p of pts) byDay.set(iso(p.t), [iso(p.t), p.y, p.id]);
  const plot = chart({ points: [...byDay.values()], streams: metric.stream ? streamsOf(recentStreams, metric.stream) : undefined, base: `/${tab.slug}/`,
    unit: f.unit, int: f.type === "int", usual: verdict?.band ?? undefined, best: week.length > 1 ? [iso(week[0].t), iso(week.at(-1)!.t)] : undefined });
  const inBest = new Set(week.map((p) => p.id));
  const lastDays = [...pts].reverse().slice(0, 14).map((p) => `<li><a href="/${tab.slug}/${p.id}">${short(p.t)}</a><span class="sets"><span${inBest.has(p.id) ? ' class="good"' : ""}>${escape(amount(f, p.y))}</span></span></li>`);
  // just the value and its verdict: the chart says the rest (the best week is drawn in green on it)
  const lines = verdict ? `<p class="verdict"><span class="${verdict.tone}">${escape(amount(f, verdict.value))}</span>${verdict.word ? ` <span class="${verdict.tone}">${escape(verdict.word)}</span>` : ""}</p>` : "";
  return `${head}
${lines}
${plot}
<ul class="sessions">${lastDays.join("")}</ul>`;
}
/** The streams of the newest days that have this one, oldest first. */
const streamsOf = (recent: { id: number; date: string; series: db.Series }[], name: string): ChartStream[] =>
  recent.filter((r) => r.series[name]?.points?.length).map((r) => ({ date: r.date, id: r.id, points: r.series[name].points })).reverse();

/** Plain rows: your average confidence and how many came true; once `min` (default 10) are scored, the same for each confidence level. Nothing until one is scored. */
function calibration(v: Extract<View, { kind: "calibration" }>, { rows }: Ctx): ViewResult | null {
  const scored = rows.filter((row) => row[v.verdict] !== undefined && Number.isFinite(Number(row[v.confidence])));
  if (!scored.length) return null;
  const right = (rs: db.Row[]) => rs.filter((row) => row[v.verdict] === v.right).length;
  const said = Math.round(scored.reduce((sum, row) => sum + Number(row[v.confidence]), 0) / scored.length);
  const items = [["avg confidence", `${said}%`], ["came true", `${right(scored)} of ${scored.length}`]];
  if (scored.length >= (v.min ?? 10)) {
    const buckets = new Map<number, db.Row[]>();
    for (const row of scored) { const b = Math.round(Number(row[v.confidence]) / 10) * 10; buckets.set(b, [...(buckets.get(b) ?? []), row]); }
    for (const [b, rs] of [...buckets].sort((a, z) => a[0] - z[0])) items.push([`said ${b}%`, `${right(rs)} of ${rs.length} came true`]);
  }
  return result("calibration", "calibration", Object.fromEntries(items), `<dl class="facts">${items.map(([k, val]) => `<dt>${escape(k)}</dt><dd>${escape(val)}</dd>`).join("")}</dl>`);
}


/** One exercise: every session on a zoomable chart (a dot opens its session), then every session's sets, the best in green. */
export async function liftPage(tab: Tab, database: D1Database, exercise: string): Promise<string | null> {
  const field = tab.views?.find((v): v is Extract<View, { kind: "progress" }> => v.kind === "progress")?.field;
  if (!field) return null;
  const pts = liftSeries(tab, await db.list(database, tab), field).get(exercise);
  if (!pts) return null;
  const best = pts.reduce((a, p) => (p.top > a.top || (p.top === a.top && p.reps > a.reps) ? p : a));
  // one dot per session day (a day with two sessions keeps its heavier best set); the best session in green
  const byDay = new Map<string, (typeof pts)[number]>();
  for (const p of pts) { const d = new Date(p.t).toISOString().slice(0, 10), had = byDay.get(d); if (!had || p.top >= had.top) byDay.set(d, p); }
  const bestDay = new Date(best.t).toISOString().slice(0, 10);
  const plot = chart({ points: [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, p]) => [d, p.top, p.row.id]), base: `/${tab.slug}/`,
    unit: tab.fields.find((f) => f.name === field)?.unit ?? "lb", int: false, best: [bestDay, bestDay] });
  const sessions = [...pts].reverse().map((p) => `<li><a href="/${tab.slug}/${p.row.id}">${short(p.t)}</a><span class="sets">${p.sets.map((s) => { const cls = s === p.label ? (p === best ? "good" : "top") : ""; return `<span${cls ? ` class="${cls}"` : ""}>${escape(s)}</span>`; }).join("")}</span></li>`);
  return `<h1>${escape(exercise)}</h1>
<p class="lift-best">best <span class="good">${escape(best.label)}</span> on ${short(best.t)}</p>
${plot}
<ul class="sessions">${sessions.join("")}</ul>`;
}

export const LIFT_CSS = `
  .lift-best { color: var(--muted); font-size: var(--fs-small); margin-top: 8px; }
  .verdict { margin-top: 8px; font-size: var(--fs-heading); color: var(--bright); }
  .verdict span + span { color: var(--muted); font-size: var(--fs-body); margin-left: 8px; }
  .verdict span.good { color: var(--good); } .verdict span.bad { color: var(--bad); }
  .sessions { list-style: none; margin-top: 36px; display: grid; gap: 12px; }
  .sessions li { display: grid; grid-template-columns: 70px 1fr; gap: 16px; align-items: baseline; }
  .sessions li > a { color: var(--muted); font-size: var(--fs-small); }
  .sets { display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--muted); }
  .sets .top { color: var(--bright); }
`;

// ---- sessions: load, the run limit, weeks, records (training) ----
//
// Sessions don't come every day, so these count whole local days in windows that end today where you are: the newest row's
// own offset (`at` is written with one) says what "today" is. No model and no invented threshold: load is judged only
// against your own past weeks, and the run limit is the 2025 study's (a run over 10% longer than the longest of the 30 days
// before it raised overuse injuries, Frandsen et al., BJSM; docs/training.md).

const OFFSET = /([+-])(\d{2}):(\d{2})$/;
/** Today where you are, as a utc midnight: now shifted by the newest timed row's offset (else utc). */
function localToday(rows: db.Row[], field: string): number {
  let newest: { t: number; off: number } | null = null;
  for (const r of rows) {
    const at = String(r[field] ?? ""), m = OFFSET.exec(at), t = Date.parse(at);
    if (m && at.length > 10 && Number.isFinite(t) && (!newest || t > newest.t)) newest = { t, off: (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) };
  }
  const local = new Date(Date.now() + (newest?.off ?? 0) * 60_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}
type Session = { t: number; at: number; y: number; row: db.Row };
/** Rows matching `where` with a number in `field`, by local day (and instant, for order within a day), oldest first. */
function sessions(rows: db.Row[], dateF: string, field: string, where?: Record<string, string>): Session[] {
  return rows.filter((r) => matches(where, r) && r0(r[field]) && finite(Number(r[field])))
    .map((r) => ({ t: dayOf(r[dateF]), at: Date.parse(String(r[dateF])), y: Number(r[field]), row: r }))
    .filter((s): s is Session => s.t !== null).map((s) => ({ ...s, at: finite(s.at) ? s.at : s.t })).sort((a, b) => a.at - b.at);
}
const total = (ss: Session[], from: number, to: number) => ss.filter((s) => s.t >= from && s.t <= to).reduce((a, s) => a + s.y, 0);
const fieldOf = (tab: Tab, name: string) => tab.fields.find((f) => f.name === name);
const row = (name: string, val: string, why: string[], tone = "", extra = "") =>
  `<div class="metric"><span class="name">${escape(name)}</span><span class="val${tone ? ` ${tone}` : ""}">${escape(val)}</span><span class="why">${why.join("")}</span>${extra || "<span></span>"}</div>`;
const why = (text: string, tone = "") => `<span${tone ? ` class="${tone}"` : ""}>${escape(text)}</span>`;

/** The last 7 days' load next to the 28 days' weekly average. "higher" or "lower than usual" when the 7 days sit outside the
 * 10th to 90th percentile of your own past weeks (8 or more of them, up to a year), else "usual". No colour: more load is
 * neither good nor bad by itself. The box: the last 12 weeks, this one white. */
function load(v: Extract<View, { kind: "load" }>, { tab, rows }: Ctx): ViewResult | null {
  const dateF = dateField(tab), ss = sessions(rows, dateF, v.field);
  if (!ss.length) return null;
  const now = localToday(rows, dateF), acute = total(ss, now - 6 * DAY, now), chronic = total(ss, now - 27 * DAY, now) / 4;
  const past: number[] = []; // the 7 days ending 1, 2, ... weeks ago, while they're after the first session
  for (let k = 1; k <= 52 && now - 7 * k * DAY - 6 * DAY >= ss[0].t; k++) past.push(total(ss, now - 7 * k * DAY - 6 * DAY, now - 7 * k * DAY));
  const band = past.length >= 8 ? [quantile(past, 0.1), quantile(past, 0.9)] : null;
  const word = !band ? "" : acute > band[1] ? "higher than usual" : acute < band[0] ? "lower than usual" : "usual";
  const label = v.label ?? "load", f = fieldOf(tab, v.field), weeks = [...past.slice(0, 11).reverse(), acute];
  const html = row("7 days", amount(f, acute), [...(word ? [why(word)] : [])], "", weeks.length > 1 ? dotBox(weeks) : "")
    + row("4-week average", amount(f, chronic), []);
  return result("load", label, { field: v.field, last_7_days: Math.round(acute), per_week_last_28_days: Math.round(chronic), verdict: word || null,
    ...(band ? { usual_week: band.map(Math.round) } : {}), weeks: weeks.map(Math.round) }, `<div class="metrics">${html}</div>`);
}

/** The longest session in the last `days` (30) and the next one's limit, `over` (10) % past it; every session in that window
 * that went past the longest of the `days` before it, in red. */
function limit(v: Extract<View, { kind: "limit" }>, { tab, rows }: Ctx): ViewResult | null {
  const dateF = dateField(tab), ss = sessions(rows, dateF, v.field, v.where).filter((s) => s.y > 0);
  if (!ss.length) return null;
  const days = v.days ?? 30, over = v.over ?? 10, f = fieldOf(tab, v.field), now = localToday(rows, dateF), from = now - (days - 1) * DAY;
  const recent = ss.filter((s) => s.t >= from && s.t <= now);
  const longest = recent.length ? recent.reduce((a, s) => (s.y >= a.y ? s : a)) : null;
  const spikes = recent.map((s) => {
    const before = ss.filter((p) => p.at < s.at && p.t > s.t - days * DAY);
    const prior = before.length ? Math.max(...before.map((p) => p.y)) : null;
    return prior !== null && s.y > prior * (1 + over / 100) ? { s, prior, pct: Math.round((s.y / prior - 1) * 100) } : null;
  }).filter((x): x is { s: Session; prior: number; pct: number } => x !== null);
  const label = v.label ?? "limit", next = longest ? longest.y * (1 + over / 100) : null;
  const html = (longest ? row(`longest in ${days} days`, amount(f, longest.y), [why(short(longest.t))]) + row("next under", amount(f, next!), [])
    : row(`longest in ${days} days`, "none", []))
    + spikes.map((x) => row(short(x.s.t), amount(f, x.s.y), [why(`${x.pct}% past the longest before it, ${amount(f, x.prior)}`, "bad")], "bad")).join("");
  return result("limit", label, { field: v.field, where: v.where ?? null, days, over_percent: over,
    longest: longest ? { value: longest.y, on: isoDay(longest.t), id: longest.row.id } : null, next_under: next === null ? null : Math.round(next * 100) / 100,
    over_the_limit: spikes.map((x) => ({ value: x.s.y, on: isoDay(x.s.t), id: x.s.row.id, longest_before: x.prior, percent_over: x.pct })) }, `<div class="metrics">${html}</div>`);
}

/** Each value of `by` (a sport) over the last `weeks` (12) 7-day weeks: `fields` summed, the newest week shown with a box of all
 * of them; `zones` as each field's share of the last 28 days. */
function weeks(v: Extract<View, { kind: "weeks" }>, { tab, rows }: Ctx): ViewResult | null {
  const dateF = dateField(tab), n = v.weeks ?? 12, now = localToday(rows, dateF), from = now - (7 * n - 1) * DAY;
  const inRange = rows.filter((r) => { const t = dayOf(r[dateF]); return t !== null && t >= from && t <= now; });
  if (!inRange.length) return null;
  const kinds = [...new Set(inRange.map((r) => String(r[v.by] ?? "")).filter(Boolean))];
  const per = (kind: string, field: string) => Array.from({ length: n }, (_, i) => {
    const end = now - (n - 1 - i) * 7 * DAY;
    return total(sessions(inRange, dateF, field, { [v.by]: kind }), end - 6 * DAY, end);
  });
  // the sports of the last 4 weeks, most time first: one you stopped months ago isn't today's picture (the json keeps every sport)
  // sessions per week too: a session logged without a time (a gym day the agent wrote, no watch) still happened
  const count = (kind: string) => Array.from({ length: n }, (_, i) => {
    const end = now - (n - 1 - i) * 7 * DAY;
    return inRange.filter((r) => String(r[v.by]) === kind && (dayOf(r[dateF]) ?? 0) > end - 7 * DAY && (dayOf(r[dateF]) ?? 0) <= end).length;
  });
  const all = kinds.map((kind) => ({ kind, sessions: count(kind), sums: Object.fromEntries(v.fields.map((field) => [field, per(kind, field)])) }));
  const lately = (x: (typeof all)[number]) => x.sums[v.fields[0]].slice(-4).reduce((a, y) => a + y, 0);
  const sports = all.filter((x) => inRange.some((r) => String(r[v.by]) === x.kind && (dayOf(r[dateF]) ?? 0) > now - 28 * DAY)).sort((a, b) => lately(b) - lately(a));
  const main = fieldOf(tab, v.fields[0]);
  if (!sports.length) return null;
  const html = sports.map(({ kind, sums, sessions: done }) => {
    const last = (field: string) => sums[field][n - 1];
    const time = last(v.fields[0]) > 0 ? amount(main, last(v.fields[0])) : done[n - 1] > 0 ? "no time logged" : "none";
    const rest = v.fields.slice(1).filter((field) => last(field) > 0).map((field) => why(amount(fieldOf(tab, field), last(field))));
    return row(kind, time, [...rest, why("7 days")], "", dotBox(sums[v.fields[0]]));
  }).join("");
  let zones = "", zoneData: Record<string, number> | null = null;
  if (v.zones) {
    const xs = v.zones.map((z) => ({ z, v: total(sessions(inRange, dateF, z), now - 27 * DAY, now) })), sum = xs.reduce((a, x) => a + x.v, 0);
    if (sum > 0) {
      zoneData = Object.fromEntries(xs.map((x) => [x.z, Math.round(x.v)]));
      const word = (z: string) => metricName(z).replace(/^hr /, "");
      zones = `<div class="part"><span>28 days</span><div class="bar">${xs.filter((x) => x.v > 0).map((x) => `<i style="width:${((x.v / sum) * 100).toFixed(1)}%" title="${escape(word(x.z))}"></i>`).join("")}</div>
<div class="keys">${xs.filter((x) => x.v > 0).map((x) => `<span>${escape(`${word(x.z)} ${amount(fieldOf(tab, x.z), x.v)}`)}</span>`).join("")}</div></div>`;
    }
  }
  const label = v.label ?? "weeks";
  return result("weeks", label, { by: v.by, weeks: n, week_ends: Array.from({ length: n }, (_, i) => isoDay(now - (n - 1 - i) * 7 * DAY)),
    sports: Object.fromEntries(all.map(({ kind, sums, sessions: done }) => [kind, { sessions: done, ...Object.fromEntries(Object.entries(sums).map(([k, xs]) => [k, xs.map((x) => Math.round(x * 100) / 100)])) }])),
    ...(zoneData ? { zones_last_28_days: zoneData } : {}) }, `<div class="metrics">${html}</div>${zones}`);
}

/** Each record's best ever next to its best in the last `days` (90), each opening its session. The recent one is green when it
 * is the best ever. */
function records(v: Extract<View, { kind: "records" }>, { tab, rows }: Ctx): ViewResult | null {
  const dateF = dateField(tab), days = v.days ?? 90, now = localToday(rows, dateF), from = now - (days - 1) * DAY;
  const out: Record<string, unknown>[] = [];
  const html = v.records.map((r) => {
    const ss = sessions(rows, dateF, r.field, r.where).filter((s) => s.y > 0);
    if (!ss.length) return "";
    // best ever: the first time it was reached; the recent best: the latest time (a tie today shows today)
    const pick = (xs: Session[], latest: boolean) => xs.reduce((a, s) => ((r.best === "max" ? s.y > a.y : s.y < a.y) || (latest && s.y === a.y) ? s : a));
    const best = pick(ss, false), recentOnes = ss.filter((s) => s.t >= from), recent = recentOnes.length ? pick(recentOnes, true) : null;
    const f = fieldOf(tab, r.field), isBest = recent !== null && recent.y === best.y;
    const at = (s: Session) => ({ value: s.y, shown: amount(f, s.y), on: isoDay(s.t), id: s.row.id });
    out.push({ label: r.label, field: r.field, best: r.best, best_ever: at(best), [`best_last_${days}_days`]: recent ? at(recent) : null });
    const shown = recent ?? best;
    const words = !recent ? [why(`best ${short(best.t)}`), why(`none in ${days} days`)] : isBest ? [why(short(recent.t)), why("best ever")] : [why(short(recent.t)), why(`best ${amount(f, best.y)} ${short(best.t)}`)];
    return `<a class="metric" href="/${tab.slug}/${shown.row.id}"><span class="name">${escape(r.label)}</span><span class="val${isBest ? " good" : ""}">${escape(amount(f, shown.y))}</span><span class="why">${words.join("")}</span><span></span></a>`;
  }).filter(Boolean);
  if (!html.length) return null;
  return result("records", v.label ?? "records", { days, records: out }, `<div class="metrics">${html.join("")}</div>`);
}

/** Every view of a tab that has something to say, in order: its numbers and its html. Every row is loaded only for views that
 * need them all; metrics read a window of recent rows and let sqlite find the bests, so a tab with years of days stays cheap. */
/** The rows and the tabs their refs reach as a graph: its nodes and edges are the data, drawn by src/graph.ts. */
async function graphView(v: Extract<View, { kind: "graph" }>, { tab, database }: Ctx): Promise<ViewResult | null> {
  const g = await graph(database, tab);
  return g.nodes.length ? result("graph", v.label ?? "connections", g, graphBox(g)) : null;
}

export async function computeViews(tab: Tab, database: D1Database): Promise<ViewResult[]> {
  if (!tab.views?.length) return [];
  let recent: Promise<db.Row[]> | undefined;
  const ctx: Ctx = { tab, rows: tab.views.some((v) => v.kind !== "metrics") ? await db.list(database, tab) : [], database,
    recent: () => (recent ??= db.since(database, tab, dateField(tab), isoDay(today() - (RECENT - 1) * DAY))) };
  const parts = await Promise.all(tab.views.map((v) => {
    switch (v.kind) {
      case "progress": return progress(v, ctx);
      case "strip": return strip(v, ctx);
      case "line": return line(v, ctx);
      case "upcoming": return upcoming(v, ctx);
      case "calibration": return calibration(v, ctx);
      case "list": return list(v, ctx);
      case "metrics": return metrics(v, ctx);
      case "load": return load(v, ctx);
      case "limit": return limit(v, ctx);
      case "weeks": return weeks(v, ctx);
      case "records": return records(v, ctx);
      case "graph": return graphView(v, ctx);
    }
  }));
  const out: ViewResult[] = [];
  parts.forEach((p, i) => { if (p) out.push({ ...p, page: tab.views![i].page !== false }); });
  return out;
}

/** The views as the page shows them. */
export async function renderViews(tab: Tab, database: D1Database): Promise<string> {
  const html = (await computeViews(tab, database)).filter((v) => v.page).map((v) => v.html).join("\n");
  return html ? `<div class="views">\n${html}\n</div>` : "";
}
