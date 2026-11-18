// Views: what a tab opens on, above its list. Each answers one question from the rows, configured in the
// tab definition (`views`), so a tab added later can use them too. A view with nothing to say renders nothing.
// Charts are small inline svgs; green is good, red is bad, everything else is grey.
import { escape } from "../../../design/html.ts";
import * as db from "./db.ts";
import { parseLifts, type Tab, type View } from "./schema.ts";

export const VIEW_CSS = `
  .views { margin-top: 32px; display: grid; gap: 40px; }
  .view h2 { font-size: 13px; font-weight: 450; color: #6a6a66; margin-bottom: 12px; }
  .view .big { font-size: 26px; color: #efebe0; letter-spacing: -0.02em; line-height: 1.2; }
  .view .sub { color: #8a8a8a; font-size: 13px; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .view a { color: inherit; }
  .week { display: grid; grid-template-columns: max-content 1fr; gap: 10px 18px; align-items: center; font-size: 14px; color: #8a8a8a; }
  .dots { display: flex; gap: 6px; }
  .dots i { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid #3a3a35; }
  .dots i.on { background: #efebe0; border-color: #efebe0; }
  .week + .sub { margin-top: 12px; }
  .lifts { display: grid; gap: 16px; }
  .lift { display: grid; grid-template-columns: minmax(0, 1fr) 92px; column-gap: 16px; align-items: center; }
  .lift .name { color: #efebe0; font-size: 15px; }
  .lift a.name:hover { color: #ffffff; }
  .lift .sub { grid-column: 1; margin-top: 2px; }
  .lift svg { grid-row: 1 / span 2; grid-column: 2; }
  svg.spark { width: 92px; height: 26px; overflow: visible; }
  svg.spark polyline { fill: none; stroke: #a9a59a; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
  svg.spark circle { fill: #efebe0; }
  svg.line { width: 100%; height: 80px; display: block; margin-top: 14px; overflow: visible; }
  svg.line polyline { fill: none; stroke: #a9a59a; stroke-width: 1.5; } svg.line line { stroke: #3a3a35; stroke-dasharray: 3 4; }
  .since { display: flex; flex-wrap: wrap; gap: 10px 22px; font-size: 15px; }
  .since small { color: #6a6a66; margin-left: 6px; font-size: 13px; }
  .rowlist { list-style: none; display: grid; gap: 10px; }
  .rowlist li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: baseline; font-size: 15px; }
  .rowlist small { color: #8a8a8a; font-size: 13px; white-space: nowrap; }
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

type Ctx = { tab: Tab; rows: db.Row[]; database: D1Database };
const dateField = (tab: Tab) => (tab.sort !== "id" ? tab.sort : tab.group ?? "created_at");
const title = (tab: Tab, row: db.Row) => escape(row[tab.title] ?? "untitled");
const section = (heading: string, body: string) => `<section class="view"><h2>${escape(heading)}</h2>${body}</section>`;

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

/** This week's sessions as circles against the goal, plus marked sessions (leg days). Red when the last session is over a week old. */
function weekly(v: Extract<View, { kind: "weekly" }>, { tab, rows }: Ctx): string {
  const now = today(), monday = now - ((new Date(now).getUTCDay() + 6) % 7) * DAY;
  const count = (filter: (r: db.Row) => boolean) =>
    new Set(rows.filter(filter).map((r) => dayOf(r[dateField(tab)])).filter((d): d is number => d !== null && d >= monday)).size;
  const dots = (done: number, goal?: number) => `<span class="dots">${Array.from({ length: Math.max(done, goal ?? done, 1) }, (_, i) => `<i class="${i < done ? "on" : ""}"></i>`).join("")}</span>`;
  const grid = [`<span>sessions</span>${dots(count(() => true), v.goal ? tab.goals?.[v.goal] : undefined)}`];
  if (v.mark) {
    const mark = v.mark;
    grid.push(`<span>${escape(mark.contains)}</span>${dots(count((r) => String(r[mark.field] ?? "").toLowerCase().includes(mark.contains)), mark.goal ? tab.goals?.[mark.goal] : undefined)}`);
  }
  const last = Math.max(0, ...rows.map((r) => dayOf(r[dateField(tab)]) ?? 0));
  const stale = last && now - last > 7 * DAY ? `<p class="sub"><span class="bad">last session ${ago(last)}</span></p>` : "";
  return section("this week", `<div class="week">${grid.join("")}</div>${stale}`);
}

/** How long since each value last appeared; red after two weeks. */
function since(v: Extract<View, { kind: "since" }>, { tab, rows }: Ctx): string {
  const now = today();
  const items = v.values.map((value) => ({
    value,
    last: Math.max(0, ...rows.filter((r) => String(r[v.field] ?? "").toLowerCase().split(/\s*,\s*/).includes(value)).map((r) => dayOf(r[dateField(tab)]) ?? 0)),
  })).sort((a, b) => a.last - b.last);
  const html = items.map(({ value, last }) => `<span class="${!last || now - last > 14 * DAY ? "bad" : ""}">${escape(value)}<small>${last ? ago(last) : "never"}</small></span>`);
  return section("last trained", `<div class="since">${html.join("")}</div>`);
}

/** A number over time; green when moving toward the goal, red when away. `tab` reads another tab's rows. */
async function line(v: Extract<View, { kind: "line" }>, { tab, rows, database }: Ctx): Promise<string> {
  const source = v.tab ? await db.tab(database, v.tab) : tab;
  if (!source) return "";
  const sourceRows = v.tab ? await db.list(database, source, { limit: 1000 }) : rows;
  const unit = source.fields.find((f) => f.name === v.field)?.unit;
  const u = unit ? (unit === "%" ? "%" : ` ${unit}`) : "";
  const pts = sourceRows.map((row) => ({ t: dayOf(row[dateField(source)]), y: Number(row[v.field]) }))
    .filter((p): p is { t: number; y: number } => p.t !== null && Number.isFinite(p.y) && p.y !== 0).sort((a, b) => a.t - b.t);
  if (!pts.length) return "";
  const goal = v.goal ? tab.goals?.[v.goal] ?? source.goals?.[v.goal] : undefined;
  const first = pts[0], last = pts.at(-1)!, change = last.y - first.y;
  const tone = goal === undefined || change === 0 ? "" : Math.sign(goal - first.y) === Math.sign(change) ? "good" : "bad";
  const sub = [pts.length > 1 ? `<span class="${tone}">${change >= 0 ? "+" : ""}${fmt(change)}${u} since ${short(first.t)}</span>` : `<span>${short(last.t)}</span>`,
    goal !== undefined && goal !== last.y ? `<span>${fmt(Math.abs(goal - last.y))}${u} to ${fmt(goal)}${u}</span>` : ""].join("");
  let chart = "";
  if (pts.length > 1) {
    const ys = [...pts.map((p) => p.y), ...(goal !== undefined ? [goal] : [])];
    const min = Math.min(...ys), range = Math.max(...ys) - min || 1, span = last.t - first.t || 1;
    const X = (t: number) => ((t - first.t) / span) * 100, Y = (y: number) => 74 - ((y - min) / range) * 68;
    chart = `<svg class="line" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">${goal !== undefined ? `<line x1="0" x2="100" y1="${Y(goal)}" y2="${Y(goal)}" vector-effect="non-scaling-stroke"/>` : ""}<polyline points="${pts.map((p) => `${X(p.t).toFixed(2)},${Y(p.y).toFixed(1)}`).join(" ")}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const name = v.field.replaceAll("_", " ").replace(/ (kg|lb|percentage|cm)$/, "");
  return section(name, `<p class="big">${fmt(last.y)}${escape(u)}</p><p class="sub">${sub}</p>${chart}`);
}

/** Rows whose date is within `within_days` or already past, soonest first. Nothing due, nothing shown. */
function due(v: Extract<View, { kind: "due" }>, { tab, rows }: Ctx): string {
  const now = today(), until = now + (v.within_days ?? 30) * DAY;
  const soon = rows.filter((row) => Object.entries(v.where ?? {}).every(([k, val]) => row[k] === val))
    .map((row) => ({ row, t: dayOf(row[v.field]) })).filter((x): x is { row: db.Row; t: number } => x.t !== null && x.t <= until).sort((a, b) => a.t - b.t);
  if (!soon.length) return "";
  const html = soon.map(({ row, t }) => `<li><a href="/${tab.slug}/${row.id}">${title(tab, row)}</a><small class="${t < now ? "bad" : ""}">${t < now ? `overdue ${ago(t).replace(" ago", "")}` : ago(t)}</small></li>`);
  return section("due", `<ul class="rowlist">${html.join("")}</ul>`);
}

/** How often each confidence level came true. Says nothing until `min` (default 10) rows are scored. */
function calibration(v: Extract<View, { kind: "calibration" }>, { rows }: Ctx): string {
  const scored = rows.filter((row) => row[v.verdict] !== undefined && Number.isFinite(Number(row[v.confidence])));
  if (scored.length < (v.min ?? 10)) return "";
  const buckets = new Map<number, { n: number; right: number }>();
  for (const row of scored) {
    const b = Math.round(Number(row[v.confidence]) / 10) * 10, cur = buckets.get(b) ?? { n: 0, right: 0 };
    buckets.set(b, { n: cur.n + 1, right: cur.right + (row[v.verdict] === v.right ? 1 : 0) });
  }
  const html = [...buckets].sort((a, b) => a[0] - b[0]).map(([b, { n, right }]) => {
    const actual = Math.round((right / n) * 100);
    return `<li><span>said ${b}%</span><small class="${Math.abs(actual - b) <= 10 ? "good" : "bad"}">came true ${actual}%</small></li>`;
  });
  return section("calibration", `<ul class="rowlist">${html.join("")}</ul>`);
}

/** Rows whose date is older than `days`, oldest first. */
function stale(v: Extract<View, { kind: "stale" }>, { tab, rows }: Ctx): string {
  const now = today();
  const old = rows.map((row) => ({ row, t: dayOf(row[v.field]) })).filter((x): x is { row: db.Row; t: number } => x.t !== null && now - x.t > v.days * DAY).sort((a, b) => a.t - b.t);
  if (!old.length) return "";
  const html = old.slice(0, 6).map(({ row, t }) => `<li><a href="/${tab.slug}/${row.id}">${title(tab, row)}</a><small>${ago(t)}</small></li>`);
  return section(v.label ?? "keep warm", `<ul class="rowlist">${html.join("")}</ul>`);
}

/** One exercise: every session plotted, then every session's sets (the best in green), each linking to its session. */
export async function liftPage(tab: Tab, database: D1Database, exercise: string): Promise<string | null> {
  const field = tab.views?.find((v): v is Extract<View, { kind: "progress" }> => v.kind === "progress")?.field;
  if (!field) return null;
  const pts = liftSeries(tab, await db.list(database, tab, { limit: 1000 }), field).get(exercise);
  if (!pts) return null;
  const W = 600, H = 220, L = 44, B = 26, T = 12;
  const tops = pts.map((p) => p.top), min = Math.min(...tops), max = Math.max(...tops), range = max - min || 1;
  const t0 = pts[0].t, span = pts.at(-1)!.t - t0 || 1;
  const X = (t: number) => (pts.length === 1 ? (L + W) / 2 : L + ((t - t0) / span) * (W - L - 8));
  const Y = (y: number) => T + (1 - (y - min) / range) * (H - T - B);
  const best = pts.reduce((a, p) => (p.top > a.top || (p.top === a.top && p.reps > a.reps) ? p : a));
  const chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(exercise)}: best set per session">
<text x="${L - 8}" y="${Y(max) + 4}" text-anchor="end">${fmt(max)}</text><text x="${L - 8}" y="${Y(min) + 4}" text-anchor="end">${fmt(min)}</text>
<text x="${L}" y="${H - 6}">${short(t0)}</text><text x="${W - 8}" y="${H - 6}" text-anchor="end">${short(pts.at(-1)!.t)}</text>
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
  .lift-best { color: #8a8a8a; font-size: 14px; margin-top: 8px; }
  svg.chart { width: 100%; height: auto; display: block; margin-top: 28px; overflow: visible; }
  svg.chart polyline { fill: none; stroke: #6a6a66; stroke-width: 1.5; }
  svg.chart circle { fill: #a9a59a; } svg.chart circle.best { fill: #6f9e6a; } svg.chart a:hover circle { fill: #efebe0; }
  svg.chart text { fill: #6a6a66; font-size: 11px; }
  .sessions { list-style: none; margin-top: 36px; display: grid; gap: 12px; }
  .sessions li { display: grid; grid-template-columns: 70px 1fr; gap: 16px; align-items: baseline; font-size: 15px; }
  .sessions li > a { color: #8a8a8a; font-size: 14px; }
  .sets { display: flex; flex-wrap: wrap; gap: 4px 16px; color: #8a8a8a; }
  .sets .top { color: #efebe0; }
`;

/** All of a tab's views that have something to say, in order. */
export async function renderViews(tab: Tab, database: D1Database): Promise<string> {
  if (!tab.views?.length) return "";
  const ctx = { tab, rows: await db.list(database, tab, { limit: 1000 }), database };
  const parts = await Promise.all(tab.views.map((v) => {
    switch (v.kind) {
      case "progress": return progress(v, ctx);
      case "weekly": return weekly(v, ctx);
      case "since": return since(v, ctx);
      case "line": return line(v, ctx);
      case "due": return due(v, ctx);
      case "calibration": return calibration(v, ctx);
      case "stale": return stale(v, ctx);
    }
  }));
  const html = parts.filter(Boolean).join("\n");
  return html ? `<div class="views">\n${html}\n</div>` : "";
}
