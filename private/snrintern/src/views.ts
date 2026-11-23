// Views: what a tab opens on, above its list. Each answers one question from the rows, configured in the
// tab definition (`views`), so a tab added later can use them too. A view with nothing to say renders nothing.
// Charts are small inline svgs; green is good, red is bad, everything else is grey.
import { escape } from "../../../design/html.ts";
import { chart, type Chart, type ChartPoint, type ChartStream } from "./charts.ts";
import * as db from "./db.ts";
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
  .lift { display: grid; grid-template-columns: minmax(0, 1fr); }
  .lift .name { color: var(--bright); }
  .lift .sub { margin-top: 2px; }
  .rowlist { list-style: none; display: grid; gap: 10px; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 24px; margin: 0; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; }
  .rowlist li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: baseline; }
  .rowlist small { color: var(--muted); font-size: var(--fs-tiny); white-space: nowrap; }
  .rowlist small.good { color: var(--good); } .rowlist small.bad { color: var(--bad); }
  .metrics { display: grid; gap: 30px; }
  .metric { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; align-items: baseline; }
  .metric .name { color: var(--bright); }
  .metric .val { color: var(--bright); text-align: right; white-space: nowrap; }
  .metric .val small { color: var(--muted); font-size: var(--fs-tiny); margin-left: 6px; }
  .metric .val.good { color: var(--good); } .metric .val.bad { color: var(--bad); }
  .metric .sub { grid-column: 1 / -1; margin-top: 0; }
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


type Ctx = { tab: Tab; rows: db.Row[]; database: D1Database; recent: () => Promise<db.Row[]>; streams: () => Promise<{ id: number; date: string; series: db.Series }[]> };
const dateField = (tab: Tab) => (tab.sort !== "id" ? tab.sort : tab.group ?? "created_at");
const title = (tab: Tab, row: db.Row) => escape(row[tab.title] ?? "untitled");
// every view is headed by a white pill, the way admin labels its sections
const pill = (heading: string) => `<h2><span class="pill">${escape(heading)}</span></h2>`;
const section = (heading: string, body: string) => `<section class="view">${pill(heading)}${body}</section>`;

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

/** Each exercise done on 2+ days: its best set over time, linking to its own page. */
function progress(v: Extract<View, { kind: "progress" }>, { tab, rows }: Ctx): string {
  const series = liftSeries(tab, rows, v.field);
  const items = [...series].map(([name, pts]) => ({ name, pts })).filter((s) => s.pts.length >= 2)
    .sort((a, b) => b.pts.at(-1)!.t - a.pts.at(-1)!.t);
  if (!items.length) return "";
  const html = items.map(({ name, pts }) => {
    const first = pts[0], last = pts.at(-1)!;
    const best = pts.reduce((a, p) => (p.top > a.top || (p.top === a.top && p.reps > a.reps) ? p : a));
    // green: the latest session is the best and beats the first. red: the latest is below the best.
    const tone = last === best && last.top > first.top ? "good" : last.top < best.top ? "bad" : "";
    const latest = last === best ? "" : `<span>latest ${escape(last.label)}</span>`;
    // the same chart as everywhere: one dot per session day, a click opens the exercise's own page
    const href = `/${tab.slug}/lifts/${encodeURIComponent(name)}`;
    const byDay = new Map<string, ChartPoint>();
    for (const p of pts) { const d = new Date(p.t).toISOString().slice(0, 10), had = byDay.get(d); if (!had || p.top >= had[1]) byDay.set(d, [d, p.top, p.row.id]); }
    const mini = chart({ points: [...byDay.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), mini: true, href, base: `/${tab.slug}/`, unit: tab.fields.find((f) => f.name === v.field)?.unit ?? "lb" });
    return `<div class="lift"><a class="name" href="${href}">${escape(name)}</a><span class="sub"><span class="${tone}">best ${escape(best.label)}</span>${latest}</span>${mini}</div>`;
  });
  return section("progress", `<div class="lifts">${html.join("")}</div>`);
}

/** One tick per day from the first row (at most `days` back, default 182) to today, green on days that have a row; how many a week,
 * and how long since the last, red once this gap is longer than any gap between earlier rows (your own history, no fixed number).
 * `label` is the heading ("sessions"); the last line uses it without the s. */
function strip(v: Extract<View, { kind: "strip" }>, { rows }: Ctx): string {
  const now = today();
  const dated = rows.map((r) => dayOf(r[v.field])).filter((d): d is number => d !== null && d <= now);
  if (!dated.length) return "";
  const days = new Set(dated), sorted = [...days].sort((a, b) => a - b), last = sorted.at(-1)!;
  const longest = sorted.slice(1).reduce((gap, t, i) => Math.max(gap, t - sorted[i]), 0);
  const start = Math.max(Math.min(...dated), now - ((v.days ?? 182) - 1) * DAY);
  const ticks: string[] = [];
  for (let t = start; t <= now; t += DAY) ticks.push(`<i class="${days.has(t) ? "up" : ""}" title="${short(t)}"></i>`);
  const perWeek = dated.filter((d) => d >= start).length / Math.max(1, (now - start + DAY) / (7 * DAY));
  const heading = v.label ?? "entries";
  return `<section class="view"><div class="strip-head">${pill(heading)}<span>${fmt(Math.round(perWeek * 10) / 10)} a week</span></div>
<div class="strip">${ticks.join("")}</div><div class="strip-ends"><span>${short(start)}</span><span>today</span></div>
<p class="sub"><span class="${sorted.length > 1 && now - last > longest ? "bad" : ""}">last ${escape(heading.replace(/s$/, ""))} ${ago(last)}</span></p></section>`;
}

/** Chart points, one per day (a day with two rows keeps the later). */
function perDay(pts: { t: number; y: number; id: number }[]): ChartPoint[] {
  const byDay = new Map<string, ChartPoint>();
  for (const p of pts) { const d = new Date(p.t).toISOString().slice(0, 10); byDay.set(d, [d, p.y, p.id]); }
  return [...byDay.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** A number over time: the latest, the change since the first, and a line. `tab` reads another tab's rows. No targets: it shows what happened. */
async function line(v: Extract<View, { kind: "line" }>, { tab, rows, database }: Ctx): Promise<string> {
  const source = v.tab ? await db.tab(database, v.tab) : tab;
  if (!source) return "";
  const sourceRows = v.tab ? await db.list(database, source) : rows;
  const unit = source.fields.find((f) => f.name === v.field)?.unit;
  const u = unit ? (unit === "%" ? "%" : ` ${unit}`) : "";
  const pts = sourceRows.map((row) => ({ t: dayOf(row[dateField(source)]), y: Number(row[v.field]), id: row.id }))
    .filter((p): p is { t: number; y: number; id: number } => p.t !== null && Number.isFinite(p.y) && p.y !== 0).sort((a, b) => a.t - b.t);
  if (!pts.length) return "";
  const first = pts[0], last = pts.at(-1)!, change = last.y - first.y;
  const sub = pts.length > 1 ? `<span>${change >= 0 ? "+" : ""}${fmt(change)}${u} since ${short(first.t)}</span>` : `<span>${short(last.t)}</span>`;
  // every day since the first, zoomable; a dot opens that day's row
  const plot = pts.length > 1 ? chart({ points: perDay(pts), base: `/${source.slug}/`, unit, int: source.fields.find((f) => f.name === v.field)?.type === "int" }) : "";
  const name = v.field.replaceAll("_", " ").replace(/ (kg|lb|percentage|cm)$/, "");
  return section(name, `<p class="big">${fmt(last.y)}${escape(u)}</p><p class="sub">${sub}</p>${plot}`);
}

/** Does a row match a view's `where` (every key equal)? */
export const matches = (where: Record<string, string> | undefined, row: db.Row) => Object.entries(where ?? {}).every(([k, val]) => row[k] === val);

/** The next `limit` (default 3) rows matching `where`, soonest first; a date already past is overdue, in red. */
function upcoming(v: Extract<View, { kind: "upcoming" }>, { tab, rows }: Ctx): string {
  const now = today();
  const next = rows.filter((row) => matches(v.where, row)).map((row) => ({ row, t: dayOf(row[v.field]) }))
    .filter((x): x is { row: db.Row; t: number } => x.t !== null).sort((a, b) => a.t - b.t).slice(0, v.limit ?? 3);
  if (!next.length) return "";
  const html = next.map(({ row, t }) => `<li><a href="/${tab.slug}/${row.id}">${title(tab, row)}</a><small class="${t < now ? "bad" : ""}">${t < now ? `overdue ${ago(t).replace(" ago", "")}` : ago(t)}</small></li>`);
  return section("upcoming", `<ul class="rowlist">${html.join("")}</ul>`);
}

/** The rows matching `where`, headed by `label`: largest `sort` first (empty last, then the tab's order), or the tab's order; `aside` shows one field at the right (a date as "2 weeks ago").
 * No dates are judged here: a book on the reading list for a year is not overdue. */
function list(v: Extract<View, { kind: "list" }>, { tab, rows }: Ctx): string {
  const key = (row: db.Row) => (v.sort && row[v.sort] !== undefined && row[v.sort] !== "" ? String(row[v.sort]) : null);
  const matching = rows.filter((row) => matches(v.where, row));
  if (v.sort) matching.sort((a, b) => { const x = key(a), y = key(b); return x === y ? 0 : x === null ? 1 : y === null ? -1 : y.localeCompare(x, undefined, { numeric: true }); });
  if (!matching.length) return "";
  const type = tab.fields.find((f) => f.name === v.aside)?.type;
  const aside = (row: db.Row) => {
    if (!v.aside || row[v.aside] === undefined || row[v.aside] === "") return "";
    const t = type === "date" || type === "datetime" ? dayOf(row[v.aside]) : null;
    return `<small>${t !== null ? ago(t) : escape(row[v.aside])}</small>`;
  };
  const html = matching.map((row) => `<li><a href="/${tab.slug}/${row.id}">${title(tab, row)}</a>${aside(row)}</li>`);
  return section(v.label, `<ul class="rowlist">${html.join("")}</ul>`);
}

// ---- metrics: numbers that come every day (health) ----

const GLANCE = 10; // days a metric's mini chart shows; a click opens every day since the first
const RECENT = 35; // rows a metrics view reads: this week and the 28 days before it (its usual), which covers the glance
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A value in its unit, as precise as the field: whole numbers for int fields, one decimal otherwise; minutes past an hour read "7h 40m". */
export function amount(f: Field | undefined, v: number): string {
  if (f?.unit === "min" && v >= 60) return `${Math.floor(v / 60)}h${Math.round(v % 60) ? ` ${Math.round(v % 60)}m` : ""}`;
  const n = Math.abs(v) >= 100 || f?.type === "int" ? Math.round(v).toLocaleString("en-US") : fmt(Math.round(v * 10) / 10);
  return f?.unit ? `${n}${f.unit === "%" ? "" : " "}${f.unit}` : n;
}
/** "resting_hr" -> "resting hr", "hrv_ms" -> "hrv": the unit is shown with the value. */
export const metricName = (name: string) => name.replace(/_(ms|min|kg|km|bpm)$/, "").replaceAll("_", " ");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const finite = (y: number) => Number.isFinite(y);
type Pt = { t: number; y: number };

const STREAM_DAYS = 3; // the newest days whose streams the pages carry: the dashboard shows the newest, the full page 1d and 3d

/** How a metric is drawn per day, from its options. */
const kindOf = (m: Metric) => (m.parts ? "stack" : m.low ? "candles" : m.band ? "band" : m.chart === "bars" ? "bars" : "line") as Chart["kind"];
/** The fields a day's mark needs, value first: candles add low and high, a band its two edges, a stack each part. */
const fieldsOf = (tab: Tab, m: Metric) => [m.field, ...(m.low && m.high ? [m.low, m.high] : m.band ?? (m.parts ? tab.parts?.find((p) => p.label === m.parts)?.fields ?? [] : []))];
/** One chart point per day (a day with two rows keeps the later): date, value, row id, then the extra fields. */
function dayPoints(entries: { id: number; date: string; values: (number | null)[] }[]): ChartPoint[] {
  const byDay = new Map<string, ChartPoint>();
  for (const e of entries) if (e.values[0] !== null) byDay.set(e.date.slice(0, 10), [e.date.slice(0, 10), e.values[0], e.id, ...e.values.slice(1).map((x) => x ?? (null as unknown as number))]);
  return [...byDay.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
/** The streams of the newest days that have this one, oldest first. */
const streamsOf = (recent: { id: number; date: string; series: db.Series }[], name: string): ChartStream[] =>
  recent.filter((r) => r.series[name]?.points?.length).map((r) => ({ date: r.date, id: r.id, points: r.series[name].points })).reverse();

/**
 * Each metric the way training shows a number: its name and this week's average (the 7 days ending at the newest day with
 * data), green or red only when that week sits more than two standard errors from the 28 days before it, by `better`; under
 * it that usual. Then the finest view there is: the newest day's stream for a metric that has one (heart rate every 2
 * minutes), else its last 10 days (dots, bars, candles or stacked bars). The name or the chart opens the full page.
 * A metric with nothing for weeks (no weigh-in) shows its latest value and when.
 */
async function metrics(v: Extract<View, { kind: "metrics" }>, { tab, database, recent, streams }: Ctx): Promise<string> {
  const rows = await recent(), dateF = dateField(tab), end = today();
  const recentStreams = v.metrics.some((m) => m.stream) ? await streams() : [];
  const quiet: string[] = [];
  const series = v.metrics.map((m) => {
    const pts = rows.map((r) => ({ t: dayOf(r[dateF]), y: Number(r[m.field]) })).filter((p): p is Pt => p.t !== null && finite(p.y)).sort((a, b) => a.t - b.t);
    if (!pts.length) quiet.push(m.field);
    return pts;
  });
  const lasts = new Map((await db.latest(database, tab, dateF, quiet)).map((l, i) => [quiet[i], l]));
  const items = v.metrics.map((m, i) => {
    const f = tab.fields.find((x) => x.name === m.field), pts = series[i];
    const name = `<a class="name" href="/${tab.slug}/metrics/${m.field}">${escape(metricName(m.field))}</a>`;
    if (!pts.length) {
      const l = lasts.get(m.field), t = l ? dayOf(l.date) : null;
      return l && t !== null ? `<div class="metric">${name}<span class="val">${escape(amount(f, Number(l.value)))} <small>${short(t)}</small></span></div>` : "";
    }
    const newest = pts.at(-1)!.t;
    const week = pts.filter((p) => p.t > newest - 7 * DAY).map((p) => p.y);
    const before = pts.filter((p) => p.t <= newest - 7 * DAY && p.t > newest - 35 * DAY).map((p) => p.y);
    let tone = "";
    if (m.better && week.length >= 3 && before.length >= 10) {
      const mb = mean(before), sd = Math.sqrt(mean(before.map((x) => (x - mb) ** 2)));
      const z = sd > 0 ? (mean(week) - mb) / (sd / Math.sqrt(week.length)) : 0;
      if (Math.abs(z) >= 2) tone = (z > 0) === (m.better === "higher") ? "good" : "bad";
    }
    const val = newest < end - 7 * DAY ? `${escape(amount(f, pts.at(-1)!.y))} <small>${short(newest)}</small>` : escape(amount(f, mean(week)));
    const stream = m.stream ? streamsOf(recentStreams, m.stream).slice(-1) : [];
    const fields = fieldsOf(tab, m);
    const glance = dayPoints(rows.filter((r) => { const t = dayOf(r[dateF]); return t !== null && t > end - GLANCE * DAY; })
      .map((r) => ({ id: r.id, date: String(r[dateF]), values: fields.map((n) => (finite(Number(r[n])) && r[n] !== undefined ? Number(r[n]) : null)) })));
    const mini = stream.length || glance.length > 1
      ? chart({ points: glance, kind: kindOf(m), streams: stream, mini: true, href: `/${tab.slug}/metrics/${m.field}`, base: `/${tab.slug}/`, unit: f?.unit, int: f?.type === "int" })
      : "";
    const shown = stream.length ? `<span>${escape(m.stream!)}, ${short(dayOf(stream[0].date)!)}</span>` : `<span>last ${GLANCE} days</span>`;
    const sub = `<p class="sub">${before.length ? `<span>usual ${escape(amount(f, mean(before)))}</span>` : ""}${mini ? shown : ""}</p>`;
    return `<div class="metric">${name}<span class="val${tone ? ` ${tone}` : ""}">${val}</span>${sub}${mini}</div>`;
  }).filter(Boolean);
  return items.length ? section(v.label, `<div class="metrics">${items.join("")}</div>`) : "";
}

/** One metric's full page: opens on its streams (the newest days) when it has them, zooms out to every day since the first;
 * its best week in green, and the last two weeks, each linking to its day. */
export async function metricPage(tab: Tab, database: D1Database, name: string): Promise<string | null> {
  const metric = tab.views?.flatMap((v) => (v.kind === "metrics" ? v.metrics : [])).find((m) => m.field === name);
  const f = tab.fields.find((x) => x.name === name);
  if (!metric || !f) return null;
  const [entries, recentStreams] = await Promise.all([db.history(database, tab, dateField(tab), fieldsOf(tab, metric)),
    metric.stream ? db.recentSeries(database, tab.slug, dateField(tab), STREAM_DAYS) : Promise.resolve([])]);
  const pts = entries.map((h) => ({ t: dayOf(h.date), y: Number(h.values[0]), id: h.id })).filter((p): p is { t: number; y: number; id: number } => p.t !== null && finite(p.y));
  const head = `<h1>${escape(metricName(name))}</h1>`;
  if (!pts.length) return `${head}<p class="lift-best">nothing yet</p>`;
  // best week: the seven days with a value whose average is best; fewer than seven, the best day
  let best: { from: number; to: number; avg: number } | null = null;
  if (metric.better) {
    const n = Math.min(7, pts.length), better = (a: number, b: number) => (metric.better === "higher" ? a > b : a < b);
    for (let i = n - 1; i < pts.length; i++) {
      const avg = mean(pts.slice(i - n + 1, i + 1).map((p) => p.y));
      if (!best || better(avg, best.avg)) best = { from: i - n + 1, to: i, avg };
    }
  }
  const week = best ? pts.slice(best.from, best.to + 1) : [];
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const plot = chart({ points: dayPoints(entries), kind: kindOf(metric), streams: metric.stream ? streamsOf(recentStreams, metric.stream) : undefined,
    base: `/${tab.slug}/`, unit: f.unit, int: f.type === "int", best: week.length > 1 && kindOf(metric) !== "stack" ? [iso(week[0].t), iso(week.at(-1)!.t)] : undefined });
  const inBest = new Set(week.map((p) => p.id));
  const lastDays = [...pts].reverse().slice(0, 14).map((p) => `<li><a href="/${tab.slug}/${p.id}">${short(p.t)}</a><span class="sets"><span${inBest.has(p.id) ? ' class="good"' : ""}>${escape(amount(f, p.y))}</span></span></li>`);
  const bestLine = best && week.length
    ? `<p class="lift-best">best ${week.length === 7 ? "week" : "day"} <span class="good">${escape(amount(f, best.avg))}</span>, ${week.length === 7 ? `<a href="/${tab.slug}/${week[0].id}">${short(week[0].t)}</a> to ` : ""}<a href="/${tab.slug}/${week.at(-1)!.id}">${short(week.at(-1)!.t)}</a></p>`
    : "";
  return `${head}
${bestLine}
${plot}
<ul class="sessions">${lastDays.join("")}</ul>`;
}

/** Plain rows: your average confidence and how many came true; once `min` (default 10) are scored, the same for each confidence level. Nothing until one is scored. */
function calibration(v: Extract<View, { kind: "calibration" }>, { rows }: Ctx): string {
  const scored = rows.filter((row) => row[v.verdict] !== undefined && Number.isFinite(Number(row[v.confidence])));
  if (!scored.length) return "";
  const right = (rs: db.Row[]) => rs.filter((row) => row[v.verdict] === v.right).length;
  const said = Math.round(scored.reduce((sum, row) => sum + Number(row[v.confidence]), 0) / scored.length);
  const items = [["avg confidence", `${said}%`], ["came true", `${right(scored)} of ${scored.length}`]];
  if (scored.length >= (v.min ?? 10)) {
    const buckets = new Map<number, db.Row[]>();
    for (const row of scored) { const b = Math.round(Number(row[v.confidence]) / 10) * 10; buckets.set(b, [...(buckets.get(b) ?? []), row]); }
    for (const [b, rs] of [...buckets].sort((a, z) => a[0] - z[0])) items.push([`said ${b}%`, `${right(rs)} of ${rs.length} came true`]);
  }
  return section("calibration", `<dl class="facts">${items.map(([k, val]) => `<dt>${escape(k)}</dt><dd>${escape(val)}</dd>`).join("")}</dl>`);
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
  .sessions { list-style: none; margin-top: 36px; display: grid; gap: 12px; }
  .sessions li { display: grid; grid-template-columns: 70px 1fr; gap: 16px; align-items: baseline; }
  .sessions li > a { color: var(--muted); font-size: var(--fs-small); }
  .sets { display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--muted); }
  .sets .top { color: var(--bright); }
`;

/** All of a tab's views that have something to say, in order. Every row is loaded only for views that need them all;
 * metrics read a window of recent rows and let sqlite find the bests, so a tab with years of days stays cheap. */
export async function renderViews(tab: Tab, database: D1Database): Promise<string> {
  if (!tab.views?.length) return "";
  let recent: Promise<db.Row[]> | undefined, streams: Promise<{ id: number; date: string; series: db.Series }[]> | undefined;
  const ctx: Ctx = { tab, rows: tab.views.some((v) => v.kind !== "metrics") ? await db.list(database, tab) : [], database,
    recent: () => (recent ??= db.since(database, tab, dateField(tab), isoDay(today() - (RECENT - 1) * DAY))),
    streams: () => (streams ??= db.recentSeries(database, tab.slug, dateField(tab), STREAM_DAYS)) };
  const parts = await Promise.all(tab.views.map((v) => {
    switch (v.kind) {
      case "progress": return progress(v, ctx);
      case "strip": return strip(v, ctx);
      case "line": return line(v, ctx);
      case "upcoming": return upcoming(v, ctx);
      case "calibration": return calibration(v, ctx);
      case "list": return list(v, ctx);
      case "metrics": return metrics(v, ctx);
    }
  }));
  const html = parts.filter(Boolean).join("\n");
  return html ? `<div class="views">\n${html}\n</div>` : "";
}
