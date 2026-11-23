// Views: what a tab opens on, above its list. Each answers one question from the rows, configured in the
// tab definition (`views`), so a tab added later can use them too. A view with nothing to say renders nothing.
// Charts are small inline svgs; green is good, red is bad, everything else is grey.
import { escape } from "../../../design/html.ts";
import * as db from "./db.ts";
import { parseLifts, type Field, type Tab, type View } from "./schema.ts";

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
  .lift { display: grid; grid-template-columns: minmax(0, 1fr) 92px; column-gap: 16px; align-items: center; }
  .lift .name { color: var(--bright); }
  .lift .sub { grid-column: 1; margin-top: 2px; }
  .lift svg { grid-row: 1 / span 2; grid-column: 2; }
  svg.spark { width: 92px; height: 26px; overflow: visible; }
  svg.spark polyline { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
  svg.spark circle { fill: var(--bright); }
  svg.line { width: 100%; height: 80px; display: block; margin-top: 14px; overflow: visible; }
  svg.line polyline { fill: none; stroke: var(--muted); stroke-width: 1.5; }
  .rowlist { list-style: none; display: grid; gap: 10px; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 24px; margin: 0; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; }
  .rowlist li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: baseline; }
  .rowlist small { color: var(--muted); font-size: var(--fs-tiny); white-space: nowrap; }
  .rowlist small.good { color: var(--good); } .rowlist small.bad { color: var(--bad); }
  .metrics { display: grid; gap: 18px; }
  .metric { display: grid; grid-template-columns: minmax(0, 1fr) auto 92px; column-gap: 16px; align-items: center; }
  .metric .name { color: var(--bright); }
  .metric .val { color: var(--bright); text-align: right; white-space: nowrap; }
  .metric .val.good { color: var(--good); } .metric .val.bad { color: var(--bad); }
  .metric .sub { grid-column: 1 / span 2; margin-top: 2px; }
  .metric svg { grid-row: 1 / span 2; grid-column: 3; }
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

function spark(values: number[]): string {
  const min = Math.min(...values), range = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 92, 24 - ((v - min) / range) * 22]);
  const [lx, ly] = pts.at(-1)!;
  return `<svg class="spark" viewBox="0 0 92 26" aria-hidden="true"><polyline points="${pts.map((p) => p.map((x) => x.toFixed(1)).join(",")).join(" ")}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2"/></svg>`;
}

type Ctx = { tab: Tab; rows: db.Row[]; database: D1Database; recent: () => Promise<db.Row[]> };
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
    return `<div class="lift"><a class="name" href="/${tab.slug}/lifts/${encodeURIComponent(name)}">${escape(name)}</a><span class="sub"><span class="${tone}">best ${escape(best.label)}</span>${latest}</span>${spark(pts.map((p) => p.top))}</div>`;
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

/** A number over time: the latest, the change since the first, and a line. `tab` reads another tab's rows. No targets: it shows what happened. */
async function line(v: Extract<View, { kind: "line" }>, { tab, rows, database }: Ctx): Promise<string> {
  const source = v.tab ? await db.tab(database, v.tab) : tab;
  if (!source) return "";
  const sourceRows = v.tab ? await db.list(database, source) : rows;
  const unit = source.fields.find((f) => f.name === v.field)?.unit;
  const u = unit ? (unit === "%" ? "%" : ` ${unit}`) : "";
  const pts = sourceRows.map((row) => ({ t: dayOf(row[dateField(source)]), y: Number(row[v.field]) }))
    .filter((p): p is { t: number; y: number } => p.t !== null && Number.isFinite(p.y) && p.y !== 0).sort((a, b) => a.t - b.t);
  if (!pts.length) return "";
  const first = pts[0], last = pts.at(-1)!, change = last.y - first.y;
  const sub = pts.length > 1 ? `<span>${change >= 0 ? "+" : ""}${fmt(change)}${u} since ${short(first.t)}</span>` : `<span>${short(last.t)}</span>`;
  let chart = "";
  if (pts.length > 1) {
    const ys = pts.map((p) => p.y);
    const min = Math.min(...ys), range = Math.max(...ys) - min || 1, span = last.t - first.t || 1;
    const X = (t: number) => ((t - first.t) / span) * 100, Y = (y: number) => 74 - ((y - min) / range) * 68;
    chart = `<svg class="line" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map((p) => `${X(p.t).toFixed(2)},${Y(p.y).toFixed(1)}`).join(" ")}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const name = v.field.replaceAll("_", " ").replace(/ (kg|lb|percentage|cm)$/, "");
  return section(name, `<p class="big">${fmt(last.y)}${escape(u)}</p><p class="sub">${sub}</p>${chart}`);
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

const RECENT = 120; // days of rows a metrics view reads: 7 to show, 28 before them as the usual, 90 for the sparkline
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A value in its unit: minutes past an hour read "7h 40m". */
export function amount(f: Field | undefined, v: number): string {
  if (f?.unit === "min" && v >= 60) return `${Math.floor(v / 60)}h${Math.round(v % 60) ? ` ${Math.round(v % 60)}m` : ""}`;
  const n = Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : fmt(Math.round(v * 10) / 10);
  return f?.unit ? `${n}${f.unit === "%" ? "" : " "}${f.unit}` : n;
}
/** "resting_hr" -> "resting hr", "hrv_ms" -> "hrv": the unit is shown with the value. */
export const metricName = (name: string) => name.replace(/_(ms|min|kg|km|bpm)$/, "").replaceAll("_", " ");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Each metric: the average of its last 7 days (ending at the newest day with data), coloured only when that week is unusual
 * for you: green or red when it sits more than two standard errors from the 28 days before it (better or worse by `better`).
 * Under it, that usual and the best ever (sqlite finds it over every row). A sparkline of 90 days. A metric that hasn't
 * moved in a week (weight, vo2max) shows its latest value and when.
 */
async function metrics(v: Extract<View, { kind: "metrics" }>, { tab, database, recent }: Ctx): Promise<string> {
  const rows = await recent(), dateF = dateField(tab);
  const ranked = v.metrics.filter((m): m is { field: string; better: "higher" | "lower" } => !!m.better);
  const best = new Map((await db.bests(database, tab, dateF, ranked)).map((b, i) => [ranked[i].field, b]));
  const items = v.metrics.map((m) => {
    const f = tab.fields.find((x) => x.name === m.field);
    const pts = rows.map((r) => ({ t: dayOf(r[dateF]), y: Number(r[m.field]), id: r.id })).filter((p): p is { t: number; y: number; id: number } =>
      p.t !== null && finite(p.y)).sort((a, b) => a.t - b.t);
    if (!pts.length) return "";
    const newest = pts.at(-1)!.t;
    const week = pts.filter((p) => p.t > newest - 7 * DAY).map((p) => p.y);
    const before = pts.filter((p) => p.t <= newest - 7 * DAY && p.t > newest - 35 * DAY).map((p) => p.y);
    const name = `<a class="name" href="/${tab.slug}/metrics/${m.field}">${escape(metricName(m.field))}</a>`;
    const sub: string[] = [];
    let val: string, tone = "";
    if (newest < today() - 7 * DAY) { // nothing this week: the latest, and when
      val = amount(f, pts.at(-1)!.y);
      sub.push(`<span>${short(newest)}</span>`);
    } else {
      const avg = mean(week);
      val = amount(f, avg);
      if (before.length) sub.push(`<span>usual ${escape(amount(f, mean(before)))}</span>`);
      if (m.better && week.length >= 3 && before.length >= 10) {
        const mb = mean(before), sd = Math.sqrt(mean(before.map((x) => (x - mb) ** 2)));
        const z = sd > 0 ? (avg - mb) / (sd / Math.sqrt(week.length)) : 0;
        if (Math.abs(z) >= 2) tone = (z > 0) === (m.better === "higher") ? "good" : "bad";
      }
    }
    const b = best.get(m.field);
    if (b && Number.isFinite(Number(b.value))) {
      const bt = dayOf(b.date);
      sub.push(`<span>best <a href="/${tab.slug}/${b.id}">${escape(amount(f, Number(b.value)))}</a>${bt === null ? "" : ` ${short(bt)}`}</span>`);
    }
    const spk = pts.filter((p) => p.t > newest - 90 * DAY).map((p) => p.y);
    return `<div class="metric">${name}<span class="val${tone ? ` ${tone}` : ""}">${escape(val)}</span><span class="sub">${sub.join("")}</span>${spk.length > 1 ? spark(spk) : "<span></span>"}</div>`;
  }).filter(Boolean);
  return items.length ? section(v.label, `<div class="metrics">${items.join("")}</div>`) : "";
}
const finite = (y: number) => Number.isFinite(y);

/** One metric's whole history: every day plotted, the best in green, and the last two weeks, each linking to its day. */
export async function metricPage(tab: Tab, database: D1Database, name: string): Promise<string | null> {
  const metric = tab.views?.flatMap((v) => (v.kind === "metrics" ? v.metrics : [])).find((m) => m.field === name);
  const f = tab.fields.find((x) => x.name === name);
  if (!metric || !f) return null;
  const pts = (await db.history(database, tab, dateField(tab), name)).map((h) => ({ t: dayOf(h.date), y: Number(h.value), id: h.id }))
    .filter((p): p is { t: number; y: number; id: number } => p.t !== null && finite(p.y));
  const head = `<h1>${escape(metricName(name))}</h1>`;
  if (!pts.length) return `${head}<p class="lift-best">nothing yet</p>`;
  const best = metric.better ? pts.reduce((a, p) => ((metric.better === "higher" ? p.y > a.y : p.y < a.y) ? p : a)) : null;
  const W = 600, L = 52, T = 12, H = 220, B = 26;
  const ys = pts.map((p) => p.y), min = Math.min(...ys), max = Math.max(...ys), range = max - min || 1;
  const t0 = pts[0].t, span = pts.at(-1)!.t - t0 || 1;
  const X = (t: number) => (pts.length === 1 ? (L + W) / 2 : L + ((t - t0) / span) * (W - L - 8));
  const Y = (y: number) => T + (1 - (y - min) / range) * (H - T - B);
  const chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(metricName(name))} every day">
<text x="${L - 8}" y="${Y(max) + 4}" text-anchor="end">${escape(amount(f, max))}</text><text x="${L - 8}" y="${Y(min) + 4}" text-anchor="end">${escape(amount(f, min))}</text>
<text x="${L}" y="${H - 6}" text-anchor="start">${short(t0)}</text><text x="${W - 8}" y="${H - 6}" text-anchor="end">${short(pts.at(-1)!.t)}</text>
<polyline points="${pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}"/>
${best ? `<a href="/${tab.slug}/${best.id}"><circle class="best" cx="${X(best.t).toFixed(1)}" cy="${Y(best.y).toFixed(1)}" r="4"><title>${short(best.t)}: ${escape(amount(f, best.y))}</title></circle></a>` : ""}
</svg>`;
  const lastDays = [...pts].reverse().slice(0, 14).map((p) => `<li><a href="/${tab.slug}/${p.id}">${short(p.t)}</a><span class="sets"><span${best && p === best ? ' class="good"' : ""}>${escape(amount(f, p.y))}</span></span></li>`);
  return `${head}
${best ? `<p class="lift-best">best <span class="good">${escape(amount(f, best.y))}</span> on ${short(best.t)}</p>` : ""}
${chart}
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


/** One exercise: every session plotted, then every session's sets (the best in green), each linking to its session. */
/** A date under every point. One that would touch the date before it drops to a second line; only when both lines are taken
 * (three or more sessions bunched together) does an in-between date give way. The first and the latest always show. */
function dates(ts: number[], X: (t: number) => number, y: number): { svg: string; lines: number } {
  const GAP = 48, rows: { x: number; t: number }[][] = [[], []];
  const room = (row: { x: number }[], x: number) => !row.length || x - row.at(-1)!.x >= GAP;
  ts.forEach((t, i) => {
    const x = X(t), line = room(rows[0], x) ? 0 : room(rows[1], x) ? 1 : -1;
    if (line >= 0) rows[line].push({ x, t });
    else if (i === ts.length - 1) { rows[0] = rows[0].filter((p) => x - p.x >= GAP); rows[0].push({ x, t }); }
  });
  const anchor = (t: number) => (ts.length > 1 && t === ts[0] ? "start" : ts.length > 1 && t === ts.at(-1) ? "end" : "middle");
  const svg = rows.flatMap((row, line) => row.map(({ x, t }) => `<text x="${x.toFixed(1)}" y="${y + line * 15}" text-anchor="${anchor(t)}">${short(t)}</text>`)).join("");
  return { svg, lines: rows[1].length ? 2 : 1 };
}

export async function liftPage(tab: Tab, database: D1Database, exercise: string): Promise<string | null> {
  const field = tab.views?.find((v): v is Extract<View, { kind: "progress" }> => v.kind === "progress")?.field;
  if (!field) return null;
  const pts = liftSeries(tab, await db.list(database, tab), field).get(exercise);
  if (!pts) return null;
  const W = 600, L = 44, T = 12;
  const tops = pts.map((p) => p.top), min = Math.min(...tops), max = Math.max(...tops), range = max - min || 1;
  const t0 = pts[0].t, span = pts.at(-1)!.t - t0 || 1;
  const X = (t: number) => (pts.length === 1 ? (L + W) / 2 : L + ((t - t0) / span) * (W - L - 8));
  const plot = 182; // the line's own height; dates go under it, on one line or two
  const labels = dates(pts.map((p) => p.t), X, T + plot + 20);
  const B = labels.lines === 2 ? 41 : 26, H = T + plot + B;
  const Y = (y: number) => T + (1 - (y - min) / range) * (H - T - B);
  const best = pts.reduce((a, p) => (p.top > a.top || (p.top === a.top && p.reps > a.reps) ? p : a));
  const chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(exercise)}: best set per session">
<text x="${L - 8}" y="${Y(max) + 4}" text-anchor="end">${fmt(max)}</text><text x="${L - 8}" y="${Y(min) + 4}" text-anchor="end">${fmt(min)}</text>
${labels.svg}
<polyline points="${pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.top).toFixed(1)}`).join(" ")}"/>
${pts.map((p) => `<a href="/${tab.slug}/${p.row.id}"><circle class="${p === best ? "best" : ""}" cx="${X(p.t).toFixed(1)}" cy="${Y(p.top).toFixed(1)}" r="4"><title>${short(p.t)}: ${escape(p.label)}</title></circle></a>`).join("")}
</svg>`;
  const sessions = [...pts].reverse().map((p) => `<li><a href="/${tab.slug}/${p.row.id}">${short(p.t)}</a><span class="sets">${p.sets.map((s) => { const cls = s === p.label ? (p === best ? "good" : "top") : ""; return `<span${cls ? ` class="${cls}"` : ""}>${escape(s)}</span>`; }).join("")}</span></li>`);
  return `<h1>${escape(exercise)}</h1>
<p class="lift-best">best <span class="good">${escape(best.label)}</span> on ${short(best.t)}</p>
${chart}
<ul class="sessions">${sessions.join("")}</ul>`;
}

export const LIFT_CSS = `
  .lift-best { color: var(--muted); font-size: var(--fs-small); margin-top: 8px; }
  svg.chart { width: 100%; height: auto; display: block; margin-top: 28px; overflow: visible; }
  svg.chart polyline { fill: none; stroke: var(--faint); stroke-width: 1.5; }
  svg.chart circle { fill: var(--muted); } svg.chart circle.best { fill: var(--good); } svg.chart a:hover circle { fill: var(--bright); }
  svg.chart text { fill: var(--faint); font-size: var(--fs-tiny); }
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
    }
  }));
  const html = parts.filter(Boolean).join("\n");
  return html ? `<div class="views">\n${html}\n</div>` : "";
}
