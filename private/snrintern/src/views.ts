// Views: what a tab opens on, above its list. Each one answers a single question from the rows,
// configured in the tab definition (`views`), so a tab added later can use them too.
// Charts are small inline svgs in the site's palette; nothing runs in the browser.
import { escape } from "../../../design/html.ts";
import * as db from "./db.ts";
import { parseLifts, type Tab, type View } from "./schema.ts";

export const VIEW_CSS = `
  .views { margin-top: 28px; display: grid; gap: 32px; }
  .view h2 { font-size: 13px; font-weight: 450; color: #8a8a8a; margin-bottom: 10px; }
  .view .big { font-size: 22px; color: #efebe0; letter-spacing: -0.02em; }
  .view .sub { color: #8a8a8a; font-size: 13px; margin-top: 2px; }
  .view .bad { color: #c4553f; }
  .view a { color: inherit; }
  .view .good { color: #6f9e6a; }
  .lifts { display: grid; gap: 10px; }
  .lift { display: grid; grid-template-columns: minmax(0, 1fr) 92px; column-gap: 14px; align-items: center; font-size: 14px; }
  .lift .name { color: #efebe0; }
  .lift .top { grid-column: 1; color: #8a8a8a; font-size: 13px; }
  .lift svg { grid-row: 1 / span 2; grid-column: 2; }
  svg.spark { width: 92px; height: 26px; overflow: visible; }
  svg.spark polyline { fill: none; stroke: #a9a59a; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
  svg.spark circle { fill: #efebe0; }
  svg.bars { width: 100%; height: 64px; display: block; }
  svg.bars rect.b { fill: #3a3a35; } svg.bars rect.m { fill: #a9a59a; } svg.bars line { stroke: #6a6a66; stroke-dasharray: 3 3; }
  svg.bars text { fill: #6a6a66; font-size: 9px; }
  svg.line { width: 100%; height: 90px; display: block; overflow: visible; }
  svg.line polyline { fill: none; stroke: #a9a59a; stroke-width: 1.5; } svg.line line { stroke: #6a6a66; stroke-dasharray: 3 3; } svg.line text { fill: #6a6a66; font-size: 10px; }
  .since { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 14px; }
  .since span small { color: #8a8a8a; margin-left: 4px; }
  .due li, .stale li { list-style: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid #1a1a18; font-size: 15px; }
  .due li small, .stale li small { color: #8a8a8a; font-size: 13px; white-space: nowrap; }
  .due form { display: inline-flex; gap: 6px; margin-left: 10px; }
  .due button { background: transparent; border: 1px solid #2e2e2a; color: #a9a59a; border-radius: 10px; font: inherit; font-size: 12px; padding: 1px 9px; cursor: pointer; }
  .due button:hover { border-color: #8a8a8a; color: #efebe0; }
  .calib { display: grid; gap: 6px; font-size: 14px; }
`;

const DAY = 86_400_000;
const today = () => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };
const dayOf = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const short = (t: number) => { const d = new Date(t); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
export function span(days: number): string {
  const n = Math.abs(days);
  const [c, u] = n < 14 ? [n, "day"] : n < 60 ? [Math.round(n / 7), "week"] : n < 730 ? [Math.round(n / 30.44), "month"] : [Math.round(n / 365.25), "year"];
  return `${c} ${u}${c === 1 ? "" : "s"}`;
}
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function spark(values: number[]): string {
  if (values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 92, 24 - ((v - min) / range) * 22]);
  const last = pts.at(-1)!;
  return `<svg class="spark" viewBox="0 0 92 26" aria-hidden="true"><polyline points="${pts.map((p) => p.map((x) => x.toFixed(1)).join(",")).join(" ")}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2"/></svg>`;
}

type Ctx = { tab: Tab; rows: db.Row[]; database: D1Database };
const title = (tab: Tab, row: db.Row) => escape(row[tab.title] ?? "untitled");

/** Each exercise done on 2+ days: its heaviest set over time (reps for bodyweight-only work). */
function progress(v: Extract<View, { kind: "progress" }>, { tab, rows }: Ctx): string {
  const unit = tab.fields.find((f) => f.name === v.field)?.unit ?? "lb";
  const series = new Map<string, { t: number; top: number; label: string }[]>();
  for (const row of rows) {
    const t = dayOf(row[tab.sort === "id" ? (tab.group ?? "") : tab.sort] ?? row.created_at);
    const lifts = typeof row[v.field] === "string" ? parseLifts(String(row[v.field])) : [];
    if (t === null || typeof lifts === "string") continue;
    for (const lift of lifts) {
      // bodyweight work (bw, +25) is tracked by added weight, bw = 0; reps break ties
      const bodyweight = lift.sets.some((s) => s.load === null || s.added);
      const load = (s: (typeof lift.sets)[number]) => (s.load === null ? 0 : s.load);
      const best = lift.sets.reduce((a, s) => (load(s) > load(a) || (load(s) === load(a) && s.reps > a.reps) ? s : a));
      const top = load(best);
      const label = best.load === null ? `bw × ${best.reps}` : `${best.added || bodyweight ? "+" : ""}${fmt(best.load)}${bodyweight ? "" : ` ${unit}`} × ${best.reps}`;
      series.set(lift.exercise, [...(series.get(lift.exercise) ?? []), { t, top, label }]);
    }
  }
  const items = [...series].map(([name, pts]) => ({ name, pts: pts.sort((a, b) => a.t - b.t) })).filter((s) => s.pts.length >= 2)
    .sort((a, b) => b.pts.at(-1)!.t - a.pts.at(-1)!.t);
  if (!items.length) return "";
  const rowsHtml = items.slice(0, 10).map(({ name, pts }) => {
    const first = pts[0], last = pts.at(-1)!, best = pts.reduce((a, p) => (p.top > a.top ? p : a));
    // green: the latest session is the best yet. red: the latest is below the best.
    const trend = last.top >= best.top && last.top > first.top ? "good" : last.top < best.top ? "bad" : "";
    const latest = last === best ? "" : ` · latest ${escape(last.label)}`;
    return `<div class="lift"><span class="name">${escape(name)}</span><span class="top">best <span class="${trend}">${escape(best.label)}</span>${latest} · since ${short(first.t)}</span>${spark(pts.map((p) => p.top))}</div>`;
  });
  return `<section class="view"><h2>progress: top set per lift</h2><div class="lifts">${rowsHtml.join("")}</div></section>`;
}

/** Sessions per week for the last 8 weeks against a goal; optionally the rows matching a value (leg days). */
function weekly(v: Extract<View, { kind: "weekly" }>, { tab, rows }: Ctx): string {
  const goal = v.goal ? tab.goals?.[v.goal] : undefined;
  const markGoal = v.mark?.goal ? tab.goals?.[v.mark.goal] : undefined;
  const now = today();
  const monday = now - ((new Date(now).getUTCDay() + 6) % 7) * DAY;
  const dateField = tab.group ?? tab.sort;
  const first = Math.min(...rows.map((r) => dayOf(r[dateField]) ?? Infinity));
  const count = Math.max(8, Math.min(26, Number.isFinite(first) ? Math.ceil((monday - first) / (7 * DAY)) + 1 : 8));
  const weeks = Array.from({ length: count }, (_, i) => monday - (count - 1 - i) * 7 * DAY);
  const days = (filter: (r: db.Row) => boolean) => weeks.map((w) => new Set(rows.filter((r) => filter(r)).map((r) => dayOf(r[dateField])).filter((d) => d !== null && d >= w && d < w + 7 * DAY)).size);
  const all = days(() => true);
  const marked = v.mark ? days((r) => String(r[v.mark!.field] ?? "").toLowerCase().includes(v.mark!.contains)) : [];
  const max = Math.max(goal ?? 0, ...all, 1);
  const bw = 100 / weeks.length;
  const bars = weeks.map((w, i) => {
    const h = (all[i] / max) * 46, mh = ((marked[i] ?? 0) / max) * 46;
    return `<rect class="b" x="${i * bw + 0.5}%" y="${50 - h}" width="${bw - 1}%" height="${h}"/>${mh ? `<rect class="m" x="${i * bw + 0.5}%" y="${50 - mh}" width="${bw - 1}%" height="${mh}"/>` : ""}${i % Math.ceil(weeks.length / 6) === 0 ? `<text x="${i * bw + 0.5}%" y="62">${short(w)}</text>` : ""}`;
  }).join("");
  const goalLine = goal ? `<line x1="0" x2="100%" y1="${50 - (goal / max) * 46}" y2="${50 - (goal / max) * 46}"/>` : "";
  const thisWeek = all.at(-1)!, thisMarked = marked.at(-1) ?? 0;
  const sub = [goal ? `<span class="${thisWeek >= goal ? "good" : ""}">${thisWeek} of ${goal} this week</span>` : `${thisWeek} this week`,
    v.mark ? `<span class="${markGoal && thisMarked < markGoal ? "bad" : ""}">${v.mark.contains}: ${thisMarked}${markGoal ? ` of ${markGoal}` : ""}</span>` : ""].filter(Boolean).join(" · ");
  const active = all.filter((n) => n > 0).length;
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  const lastActive = Math.max(...rows.map((r) => dayOf(r[dateField]) ?? 0));
  const gap = lastActive ? Math.round((now - lastActive) / DAY) : null;
  const history = `${fmt(avg)} a week since ${short(weeks[0])} · ${active} of ${all.length} weeks trained${gap !== null && gap > 7 ? ` · <span class="bad">last session ${span(gap)} ago</span>` : ""}`;
  return `<section class="view"><h2>sessions per week${v.mark ? ` (lighter: ${escape(v.mark.contains)})` : ""}</h2><p class="big">${sub}</p><p class="sub">${history}</p><svg class="bars" aria-hidden="true">${bars}${goalLine}</svg></section>`;
}

/** Days since each value last appeared ("legs 4 months"). */
function since(v: Extract<View, { kind: "since" }>, { tab, rows }: Ctx): string {
  const dateField = tab.group ?? tab.sort;
  const now = today();
  const items = v.values.map((value) => {
    const last = Math.max(...rows.filter((r) => String(r[v.field] ?? "").toLowerCase().split(/\s*,\s*/).includes(value)).map((r) => dayOf(r[dateField]) ?? 0));
    return { value, days: last > 0 ? Math.round((now - last) / DAY) : null };
  }).sort((a, b) => (b.days ?? 1e9) - (a.days ?? 1e9));
  const html = items.map(({ value, days }) => `<span class="${days === null || days > 14 ? "bad" : ""}">${escape(value)}<small>${days === null ? "never" : days === 0 ? "today" : `${span(days)} ago`}</small></span>`);
  return `<section class="view"><h2>last trained</h2><div class="since">${html.join("")}</div></section>`;
}

/** A number over time (bodyweight), with the goal as a dashed line. */
async function line(v: Extract<View, { kind: "line" }>, { tab, rows, database }: Ctx): Promise<string> {
  let source = rows, sourceTab = tab;
  if (v.tab) {
    const other = await db.tab(database, v.tab);
    if (!other) return "";
    sourceTab = other;
    source = await db.list(database, other, { limit: 1000 });
  }
  const field = sourceTab.fields.find((f) => f.name === v.field);
  const dateField = sourceTab.group ?? sourceTab.sort;
  const pts = source.map((r) => ({ t: dayOf(r[dateField]), y: Number(r[v.field]) })).filter((p): p is { t: number; y: number } => p.t !== null && Number.isFinite(p.y) && String(p.y) !== "")
    .filter((p) => p.y !== 0).sort((a, b) => a.t - b.t);
  const goal = v.goal ? tab.goals?.[v.goal] : undefined;
  const unit = field?.unit ? ` ${field.unit}` : "";
  const name = v.field.replaceAll("_", " ").replace(/ (kg|lb|percentage)$/, "");
  if (!pts.length) return `<section class="view"><h2>${escape(name)}</h2><p class="sub">no readings yet${goal ? ` · goal ${fmt(goal)}${unit}` : ""}</p></section>`;
  const last = pts.at(-1)!;
  const change = last.y - pts[0].y;
  const toward = goal === undefined || change === 0 ? "" : Math.sign(goal - pts[0].y) === Math.sign(change) ? "good" : "bad";
  const head = `<p class="big">${fmt(last.y)}${escape(unit)}${goal ? `<small class="sub"> · ${fmt(Math.abs(goal - last.y))}${escape(unit)} to ${fmt(goal)}</small>` : ""}</p><p class="sub">${pts.length} reading${pts.length === 1 ? "" : "s"}, latest ${short(last.t)}${pts.length > 1 ? ` · <span class="${toward}">${change >= 0 ? "+" : ""}${fmt(change)}${escape(unit)}</span> since ${short(pts[0].t)}` : ""}</p>`;
  if (pts.length < 2) return `<section class="view"><h2>${escape(name)}</h2>${head}</section>`;
  const ys = [...pts.map((p) => p.y), ...(goal ? [goal] : [])];
  const min = Math.min(...ys), max = Math.max(...ys), range = max - min || 1, t0 = pts[0].t, tr = last.t - t0 || 1;
  const X = (t: number) => ((t - t0) / tr) * 100, Y = (y: number) => 80 - ((y - min) / range) * 72;
  const poly = pts.map((p) => `${X(p.t).toFixed(2)},${Y(p.y).toFixed(1)}`).join(" ");
  const goalLine = goal ? `<line x1="0" x2="100" y1="${Y(goal)}" y2="${Y(goal)}"/>` : "";
  return `<section class="view"><h2>${escape(name)}</h2>${head}<svg class="line" viewBox="0 0 100 90" preserveAspectRatio="none" aria-hidden="true">${goalLine}<polyline points="${poly}" vector-effect="non-scaling-stroke"/></svg></section>`;
}

/** Rows whose date is due (or overdue), soonest first, each with one-click scoring buttons. */
function due(v: Extract<View, { kind: "due" }>, { tab, rows }: Ctx): string {
  const now = today(), within = (v.within_days ?? 30) * DAY;
  const open = rows.filter((r) => Object.entries(v.where ?? {}).every(([k, val]) => r[k] === val) && dayOf(r[v.field]) !== null);
  const soon = open.filter((r) => dayOf(r[v.field])! <= now + within).sort((a, b) => dayOf(a[v.field])! - dayOf(b[v.field])!);
  const scoreField = v.score ? tab.fields.find((f) => f.name === v.score!.field) : undefined;
  const item = (r: db.Row) => {
    const d = Math.round((dayOf(r[v.field])! - now) / DAY);
    const when = d < 0 ? `<span class="bad">overdue ${span(d)}</span>` : d === 0 ? "due today" : `due in ${span(d)}`;
    const buttons = scoreField ? `<form method="post" action="/${tab.slug}/${r.id}/_set">${Object.entries(v.score!.set ?? {}).map(([k, val]) => `<input type="hidden" name="${escape(k)}" value="${escape(val)}">`).join("")}${scoreField.options!.map((o) => `<button name="${escape(scoreField.name)}" value="${escape(o)}">${escape(o)}</button>`).join("")}</form>` : "";
    return `<li><a href="/${tab.slug}/${r.id}">${title(tab, r)}</a><small>${when}${buttons}</small></li>`;
  };
  if (soon.length) return `<section class="view due"><h2>due for review</h2><ul>${soon.map(item).join("")}</ul></section>`;
  const next = open.sort((a, b) => dayOf(a[v.field])! - dayOf(b[v.field])!)[0];
  return `<section class="view"><h2>due for review</h2><p class="sub">nothing in the next ${v.within_days ?? 30} days.${next ? ` next: <a href="/${tab.slug}/${next.id}">${title(tab, next)}</a>, in ${span(Math.round((dayOf(next[v.field])! - now) / DAY))}.` : ""}</p></section>`;
}

/** How often each confidence level came true. Needs `min` scored rows before it says anything. */
function calibration(v: Extract<View, { kind: "calibration" }>, { rows }: Ctx): string {
  const scored = rows.filter((r) => r[v.verdict] !== undefined && Number.isFinite(Number(r[v.confidence])));
  const min = v.min ?? 10;
  if (scored.length < min) {
    const right = scored.filter((r) => r[v.verdict] === v.right).length;
    return `<section class="view"><h2>calibration</h2><p class="sub">${scored.length} of ${min} scored before this means anything${scored.length ? ` (so far ${right} right)` : ""}.</p></section>`;
  }
  const buckets = new Map<number, { n: number; right: number }>();
  for (const r of scored) {
    const b = Math.round(Number(r[v.confidence]) / 10) * 10;
    const cur = buckets.get(b) ?? { n: 0, right: 0 };
    buckets.set(b, { n: cur.n + 1, right: cur.right + (r[v.verdict] === v.right ? 1 : 0) });
  }
  const lines = [...buckets].sort((a, b) => a[0] - b[0]).map(([b, { n, right }]) => {
    const actual = Math.round((right / n) * 100);
    return `<div>said ${b}% → came true ${actual}% <span class="sub">(${right} of ${n})</span></div>`;
  });
  return `<section class="view"><h2>calibration</h2><div class="calib">${lines.join("")}</div></section>`;
}

/** Rows whose date is older than N days, oldest first ("keep warm"). */
function stale(v: Extract<View, { kind: "stale" }>, { tab, rows }: Ctx): string {
  const now = today();
  const old = rows.map((r) => ({ r, d: dayOf(r[v.field]) })).filter((x) => x.d !== null && now - x.d! > v.days * DAY).sort((a, b) => a.d! - b.d!);
  if (!old.length) return "";
  return `<section class="view stale"><h2>${escape(v.label ?? `not in touch for ${span(v.days)}+`)}</h2><ul>${old.slice(0, 6).map(({ r, d }) => `<li><a href="/${tab.slug}/${r.id}">${title(tab, r)}</a><small>${span(Math.round((now - d!) / DAY))} ago</small></li>`).join("")}</ul>${old.length > 6 ? `<p class="sub">and ${old.length - 6} more</p>` : ""}</section>`;
}

/** All of a tab's views, in order, as html. */
export async function renderViews(tab: Tab, database: D1Database): Promise<string> {
  if (!tab.views?.length) return "";
  const rows = await db.list(database, tab, { limit: 1000 });
  const ctx = { tab, rows, database };
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

/** The "needs you" parts of every tab for the home page: due items, people to keep warm, this week's training. */
export async function todayParts(tabs: Tab[], database: D1Database): Promise<string[]> {
  const out: string[] = [];
  for (const tab of tabs) {
    for (const v of tab.views ?? []) {
      if (v.kind !== "due" && v.kind !== "stale" && v.kind !== "weekly") continue;
      const rows = await db.list(database, tab, { limit: 1000 });
      const ctx = { tab, rows, database };
      const html = v.kind === "due" ? due(v, ctx) : v.kind === "stale" ? stale(v, ctx) : weekly(v, ctx);
      if (html) out.push(html.replace(/<h2>([^<]*)<\/h2>/, `<h2><a href="/${tab.slug}">${escape(tab.label)}</a> · $1</h2>`));
    }
  }
  return out;
}

