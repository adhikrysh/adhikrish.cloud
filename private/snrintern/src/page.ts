// The read-only pages: home (the tabs), a tab (its views, then a searchable list), a row (everything about it).
// Everything comes from the tab definition, so a tab added through the api gets the same layout.
import { escape, page as shell, type Design } from "../../../design/html.ts";
import { CHART_CSS, withCharts } from "./charts.ts";
import * as db from "./db.ts";
import { GRAPH_CSS, withGraph } from "./graph.ts";
import { parseLifts, type Field, type Tab, type Value } from "./schema.ts";
import { amount, dayWords, LIFT_CSS, liftPage, matches, metricName, metricPage, renderViews, VIEW_CSS } from "./views.ts";

/** Every page goes through here: a page with a chart or a graph gets its library and drawing script. */
const page = (p: Parameters<typeof shell>[0]) => shell({ ...p, body: withGraph(withCharts(p.body)),
  css: `${p.css ?? ""}${p.body.includes("data-chart=") ? CHART_CSS : ""}${p.body.includes("data-graph=") ? GRAPH_CSS : ""}` });

const CSS = `
  nav { flex-wrap: wrap; row-gap: 6px; }
  nav .external { margin-left: auto; }
  .search { position: relative; margin-top: 28px; }
  .search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; stroke: var(--faint); fill: none; stroke-width: 1.6; pointer-events: none; }
  .search input { width: 100%; background: var(--surface); border: 0; border-radius: 8px; color: var(--text);
                  font: inherit; padding: 10px 40px 10px 36px; outline: none; transition: background 220ms ease; -webkit-appearance: none; }
  .search input::placeholder { color: var(--faint); }
  .search input:hover, .search input:focus { background: var(--raised); }
  .search input::-webkit-search-cancel-button { -webkit-appearance: none; }
  .search kbd { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font: var(--fs-tiny) ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--faint); }
  .search input:focus + kbd { display: none; }
  .project-list { margin-top: 24px; }
  .project-list li + li { margin-top: 26px; }
  .project-list a.head { padding-block: 0; }
  .bits { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; }
  .project-list .line { color: var(--muted); font-size: var(--fs-small); margin-top: 4px; }
  .project-list .snippet { color: var(--muted); font-size: var(--fs-small); line-height: 1.6; margin-top: 6px;
                           display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .links { margin-top: 6px; font-size: var(--fs-small); display: flex; gap: 16px; flex-wrap: wrap; }
  .links a { color: var(--muted); }
  .aside { display: inline-flex; gap: 12px; align-items: baseline; font-size: var(--fs-tiny); }
  .aside.words { font-size: var(--fs-small); }
  .meta { color: var(--muted); font-size: var(--fs-small); margin-top: 10px; }
  .detail h2 { font-size: var(--fs-small); font-weight: 450; color: var(--faint); margin-top: 32px; }
  .prose { margin-top: 8px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
  .steps { margin-top: 8px; list-style: none; line-height: 1.8; }
  .steps .ex { color: var(--muted); display: inline-block; min-width: 180px; }
  dl { margin-top: 32px; display: grid; grid-template-columns: max-content 1fr; gap: 8px 20px; }
  dt { color: var(--muted); }
  dd { overflow-wrap: anywhere; }
  .views + .search { margin-top: 40px; }
  .searching .views { display: none; }
  .empty { color: var(--muted); margin-top: 32px; }
  .pager { display: flex; justify-content: space-between; margin-top: 40px; font-size: var(--fs-small); }
  .pager a { color: var(--muted); }
  .day { margin-top: 36px; }
  .day h2 { font-size: var(--fs-small); font-weight: 450; color: var(--faint); }
  .day .project-list { margin-top: 12px; }
  .day .project-list li + li { margin-top: 18px; }
  .rows > details.group:first-child { margin-top: 24px; } /* the same gap under the search as a flat list gets */
  details.group summary { list-style: none; cursor: pointer; padding: 10px 0; }
  details.group summary::-webkit-details-marker { display: none; }
  /* the arrow turns about its own centre, so open and closed sit on the same line */
  details.group summary::before { content: "›"; color: var(--faint); display: inline-block; width: 10px; margin-right: 8px; line-height: 1; text-align: center; transition: transform 220ms ease; }
  details.group[open] summary::before { transform: rotate(90deg); }
  details.group .project-list { margin: 4px 0 18px 18px; }
  a.schema { display: inline-block; margin-top: 64px; color: var(--ghost); font-size: var(--fs-tiny); }
  a.schema:hover { color: var(--muted); }
  .section h2 { margin-top: 36px; }
  .section dl { margin-top: 12px; }
  .part { margin-top: 14px; }
  .part .bar { display: flex; height: 10px; border-radius: 2px; overflow: hidden; gap: 1px; margin-top: 6px; }
  .part .bar i { display: block; background: var(--muted); }
  .part .bar i:nth-child(2) { background: var(--faint); } .part .bar i:nth-child(3) { background: var(--ghost); } .part .bar i:nth-child(4) { background: var(--line); }
  .part .keys { display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--muted); font-size: var(--fs-small); margin-top: 6px; }
  .timeline { margin-top: 28px; }
  .timeline svg { width: 100%; height: auto; display: block; margin-top: 8px; overflow: visible; }
  .timeline polyline { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-linejoin: round; }
  .timeline text { fill: var(--faint); font-size: var(--fs-tiny); }
  .timeline line { stroke: var(--line); }
  @media (prefers-reduced-motion: reduce) { .search input, details.group summary::before { transition: none; } }
`;

// Live search over every row, not just this page: typing asks the server for the matching first page and swaps the results in
// (views hide while searching). Answers that arrive out of order are dropped; the url follows, so back and reload keep the search.
const LIVE_SEARCH = `<script>(()=>{const i=document.querySelector(".search input"),box=document.querySelector(".results");if(!i||!box)return;
let n=0,t;const run=()=>{const q=i.value.trim(),k=++n,u=new URL(location.href);u.search=q?"?q="+encodeURIComponent(q):"";
document.body.classList.toggle("searching",!!q);
fetch(u).then(r=>r.text()).then(h=>{if(k!==n)return;const d=new DOMParser().parseFromString(h,"text/html").querySelector(".results");if(d)box.innerHTML=d.innerHTML;history.replaceState(null,"",u)})};
i.addEventListener("input",()=>{clearTimeout(t);t=setTimeout(run,180)});
addEventListener("keydown",e=>{if(e.key==="/"&&document.activeElement!==i){e.preventDefault();i.focus();i.select()}})})()</script>`;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const label = (name: string) => name.replaceAll("_", " ");
type Parts = { y: number; mo: number; d: number; h?: number; mi?: string };
const parse = (value: string): Parts | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: m[4] === undefined ? undefined : Number(m[4]), mi: m[5] } : null;
};
const clock = (p: Parts) => (p.h === undefined ? "" : `${p.h % 12 || 12}:${p.mi} ${p.h < 12 ? "am" : "pm"}`);

/** "sep 17" this year, "jun 25, 2025" otherwise; "long" is "thu, sep 17, 2026". The day as written, no timezone shift. */
function day(p: Parts, style: "short" | "long"): string {
  const base = `${MONTHS[p.mo - 1]} ${p.d}`;
  if (style === "long") return `${DAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()]}, ${base}, ${p.y}`;
  return p.y === new Date().getUTCFullYear() ? base : `${base}, ${p.y}`;
}

/** "today", "yesterday", "3 weeks ago", "in 2 years", in whole calendar days from today (utc). */
function relative(p: Parts): string {
  const now = new Date();
  const days = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  const n = Math.abs(days);
  const [count, unit] = n < 14 ? [n, "day"] : n < 60 ? [Math.round(n / 7), "week"] : n < 730 ? [Math.round(n / 30.44), "month"] : [Math.round(n / 365.25), "year"];
  const span = `${count} ${unit}${count === 1 ? "" : "s"}`;
  return days < 0 ? `${span} ago` : `in ${span}`;
}

/** "https://www.linkedin.com/in/x" -> "linkedin"; "https://x.com/y" -> "x". */
const site = (url: string) => {
  try { const parts = new URL(url).hostname.replace(/^www\./, "").split("."); return parts.length > 1 ? parts.at(-2)! : parts[0]; } catch { return "link"; }
};

const present = (v: Value | undefined): v is Value => v !== undefined && v !== null && v !== "";
const field = (tab: Tab, name: string) => tab.fields.find((f) => f.name === name)!;

/**
 * One value, formatted for where it appears.
 * aside (right of a row): short dates, numbers with units, enums as a pill (tinted green or red by the field's colors).
 * line (under a row): dates as "review in 3 years" / "met 5 months ago" (the field name minus "date").
 * detail (a row's page): the full date and how long ago.
 */
function show(f: Field, value: Value, where: "aside" | "line" | "detail"): string {
  switch (f.type) {
    case "date":
    case "datetime": {
      const p = parse(String(value));
      if (!p) return escape(value);
      if (where === "line") return escape([label(f.name).replace(/ ?date$/, ""), relative(p)].filter(Boolean).join(" "));
      if (where === "detail") return escape(`${[day(p, "long"), clock(p)].filter(Boolean).join(", ")}, ${relative(p)}`);
      return escape([day(p, "short"), clock(p)].filter(Boolean).join(", "));
    }
    case "int":
    case "number": return escape(f.unit ? amount(f, Number(value)) : where === "aside" ? amount(f, Number(value)) : `${label(f.name)} ${value}`);
    case "enum": {
      const tone = f.colors?.[String(value)];
      return `<span class="pill${tone ? ` ${tone}` : ""}">${escape(value)}</span>`;
    }
    case "url": return `<a href="${escape(value)}" target="_blank" rel="noopener noreferrer">${escape(site(String(value)))}</a>`;
    case "ref": {
      // on a row's page, a link to the named row through its tab's search; in a list, only the row's title is a link
      const titles = Array.isArray(value) ? value : [String(value)];
      return titles.map((t) => (where !== "detail" ? escape(t) : `<a href="/${escape(f.to)}?q=${escape(encodeURIComponent(t))}">${escape(t)}</a>`)).join(", ");
    }
    case "lifts": {
      const lifts = parseLifts(String(value));
      return escape(typeof lifts === "string" ? value : lifts.map((l) => l.exercise).join(", "));
    }
    default: return escape(value);
  }
}

/** Under a row, a past date that an upcoming view watches reads as done ("reviewed 7 weeks ago"), or overdue in red while the row still matches it. */
function lineDate(tab: Tab, row: db.Row, f: Field): string | null {
  const view = tab.views?.find((v) => v.kind === "upcoming" && v.field === f.name);
  const p = parse(String(row[f.name]));
  if (!view || view.kind !== "upcoming" || !p || !relative(p).endsWith(" ago")) return null;
  const name = label(f.name).replace(/ ?date$/, "");
  if (matches(view.where, row)) return `<span class="bad">${escape(`${name} overdue by ${relative(p).replace(" ago", "")}`)}</span>`;
  return escape(`${name.endsWith("e") ? `${name}d` : `${name}ed`} ${relative(p)}`);
}
// onPage: on the row's own page, where its refs are links (nothing around them is one)
const bits = (tab: Tab, row: db.Row, names: string[], where: "aside" | "line", onPage = false) =>
  names.filter((n) => present(row[n])).map((n) => {
    const f = field(tab, n);
    return `<span>${(where === "line" && (f.type === "date" || f.type === "datetime") && lineDate(tab, row, f)) || show(f, row[n] as Value, onPage && f.type === "ref" ? "detail" : where)}</span>`;
  }).join("");
const links = (tab: Tab, row: db.Row) => {
  const urls = tab.fields.filter((f) => f.type === "url" && present(row[f.name]) && !tab.aside.includes(f.name) && !tab.line.includes(f.name));
  return urls.length ? `<p class="links">${urls.map((f) => show(f, row[f.name] as Value, "detail")).join("")}</p>` : "";
};
/** A row's title; a date title reads "sep 17" in lists and the full date on its own page. */
const titleOf = (tab: Tab, row: db.Row, where: "aside" | "detail") => {
  const f = field(tab, tab.title), v = row[tab.title];
  if (!present(v)) return "untitled";
  if (f.type !== "date" && f.type !== "datetime") return escape(v);
  const p = parse(String(v));
  return p ? escape(day(p, where === "detail" ? "long" : "short")) : escape(v);
};

/** Uptime top right on every page; below home, an arrow back to the parent on the left (a tab goes home, a row or lift goes to its tab). */
function nav(parent?: { href: string; label: string }): string {
  const uptime = `<a class="external" href="https://uptime.adhikrish.cloud/">uptime</a>`;
  return parent ? `<a class="back" href="${parent.href}" aria-label="back to ${escape(parent.label)}">←</a>${uptime}` : uptime;
}
const schemaLink = (tab: Tab) => `<a class="schema" href="/api/_tabs/${tab.slug}">schema</a>`;

export async function homePage(design: Design, database: D1Database): Promise<string> {
  const tabs = (await db.tabs(database)).filter((t) => !t.hidden);
  const items = tabs.map((tab) => `          <li>
            <a href="/${tab.slug}"><span>${escape(tab.label)}</span></a>
            <p>${escape(tab.about)}</p>
          </li>`);
  const body = `      <h1>senior intern</h1>
      <ul class="project-list">
${items.join("\n")}
      </ul>`;
  return page({ design, title: "senior intern", nav: nav(), body, css: CSS });
}

/** Rows a page shows. A tab grouped by a value (people by topic) is one page: its groups are collapsed, and pages would split a topic. */
const PAGE = 50;

export async function tabPage(design: Design, database: D1Database, tab: Tab, q: string, at: number): Promise<string> {
  const groupBy = tab.group ? field(tab, tab.group) : undefined;
  const byDay = groupBy && (groupBy.type === "date" || groupBy.type === "datetime") ? groupBy : undefined;
  const paged = !groupBy || !!byDay;
  const [fetched, views] = await Promise.all([
    db.list(database, tab, { q: q || undefined, ...(paged ? { limit: PAGE + 1, offset: (at - 1) * PAGE } : {}) }),
    q || at > 1 ? Promise.resolve("") : renderViews(tab, database),
  ]);
  const rows = paged ? fetched.slice(0, PAGE) : fetched, older = paged && fetched.length > PAGE;
  // a tab whose metrics carry good / bad words (health): each day in the list reads as its big picture instead of numbers
  let words: Map<number, string> | null = null;
  if (tab.sort !== "id" && rows.length && tab.views?.some((v) => v.kind === "metrics" && v.metrics.some((m) => m.log?.good || m.log?.bad))) {
    const dateF = tab.sort, dates = rows.map((r) => String(r[dateF] ?? "").slice(0, 10)).filter(Boolean).sort();
    const from = new Date(Date.parse(`${dates[0]}T00:00:00Z`) - 28 * 86_400_000).toISOString().slice(0, 10);
    const [context, newest] = await Promise.all([db.since(database, tab, dateF, from), db.list(database, tab, { limit: 1 })]);
    const newestDate = newest[0] ? String(newest[0][dateF]).slice(0, 10) : null;
    words = new Map(rows.map((r) => [r.id, dayWords(tab, context, String(r[dateF]).slice(0, 10), newestDate)
      .map((w) => `<span${w.tone ? ` class="${w.tone}"` : ""}>${escape(w.text)}</span>`).join("")]));
  }
  const item = (row: db.Row) => {
    // inside a day group the day is the heading, so the row leaves its date (and time) out
    const aside = words?.get(row.id) ?? bits(tab, row, tab.aside.filter((n) => n !== byDay?.name), "aside");
    const line = bits(tab, row, tab.line, "line");
    const snippet = tab.snippet && present(row[tab.snippet]) ? `\n            <p class="snippet">${escape(row[tab.snippet])}</p>` : "";
    return `          <li>
            <a class="head" href="/${tab.slug}/${row.id}"><span>${titleOf(tab, row, "aside")}</span><small class="aside${words ? " words" : ""}">${aside}</small></a>${line ? `\n            <p class="line bits">${line}</p>` : ""}${snippet}
            ${links(tab, row)}
          </li>`;
  };
  const ul = (r: db.Row[]) => `<ul class="project-list">\n${r.map(item).join("\n")}\n</ul>`;
  let list: string;
  if (byDay) {
    const days = new Map<string, db.Row[]>();
    for (const row of rows) {
      const key = present(row[byDay.name]) ? String(row[byDay.name]).slice(0, 10) : "";
      days.set(key, [...(days.get(key) ?? []), row]);
    }
    list = [...days].map(([key, dayRows]) => {
      const p = parse(key);
      const heading = p ? day(p, "long").replace(`, ${new Date().getUTCFullYear()}`, "") : "no date";
      return `<section class="day"><h2>${heading}</h2>${ul(dayRows)}</section>`;
    }).join("\n");
  } else if (groupBy) {
    // grouped by value, collapsed: enum options in order, free text largest first, then rows without one
    const size = new Map<string, number>();
    for (const r of rows) size.set(String(r[groupBy.name] ?? ""), (size.get(String(r[groupBy.name] ?? "")) ?? 0) + 1);
    const keys = groupBy.type === "enum" ? [...groupBy.options!, ""] : [...size.keys()].filter(Boolean).sort((a, b) => size.get(b)! - size.get(a)! || a.localeCompare(b)).concat("");
    list = keys.filter((key) => size.get(key)).map((key) =>
      `<details class="group"${q ? " open" : ""}><summary>${escape(key || `no ${label(groupBy.name)}`)}</summary>${ul(rows.filter((r) => String(r[groupBy.name] ?? "") === key))}</details>`).join("\n");
  } else list = ul(rows);
  const icon = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>`;
  const body = `      <h1>${escape(tab.label)}</h1>
${views ? `      ${views}\n` : ""}      <form class="search" action="/${tab.slug}" role="search">${icon}<input type="search" name="q" value="${escape(q)}" placeholder="search ${escape(tab.label)}" aria-label="search ${escape(tab.label)}" autocomplete="off" spellcheck="false"><kbd>/</kbd></form>
      <div class="results">
${rows.length ? `      <div class="rows">\n${list}\n      </div>` : `      <p class="empty">${q ? `nothing matches "${escape(q)}"` : at > 1 ? "nothing older" : "nothing yet"}.</p>`}
${pager(tab, q, at, older)}
      </div>
      ${schemaLink(tab)}
      ${LIVE_SEARCH}`;
  return page({ design, title: `${tab.label} | senior intern`, nav: nav({ href: "/", label: "senior intern" }), body, css: CSS + VIEW_CSS });
}

/** "← newer" and "older →" under a paged list; the search, if any, comes along. */
function pager(tab: Tab, q: string, at: number, older: boolean): string {
  const href = (p: number) => `/${tab.slug}${p > 1 || q ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}` : ""}`;
  const newer = at > 1 ? `<a href="${escape(href(at - 1))}">← newer</a>` : "<span></span>";
  return at > 1 || older ? `      <nav class="pager" aria-label="pages">${newer}${older ? `<a href="${escape(href(at + 1))}">older →</a>` : ""}</nav>` : "";
}

/** A clock time for minutes from midnight ("-20" is 11:40pm the night before). */
const hhmm = (m: number) => { const d = ((Math.round(m) % 1440) + 1440) % 1440, h = Math.floor(d / 60); return `${h % 12 || 12}${d % 60 ? `:${String(d % 60).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`; };

/** One intraday series as a timeline: a whole day on a shared axis when it spans the day, its own span otherwise (overnight hrv).
 * Plain grey, only the highest and lowest labelled, so the stack reads as one picture. */
function timeline(name: string, s: db.Series[string]): string {
  const pts = s.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) return "";
  const W = 600, H = 120, L = 40, T = 10, B = 22;
  const ms = pts.map((p) => p[0]), vs = pts.map((p) => p[1]);
  const fullDay = Math.min(...ms) >= 0 && Math.max(...ms) <= 1440 && Math.max(...ms) - Math.min(...ms) > 720;
  const [m0, m1] = fullDay ? [0, 1440] : [Math.min(...ms), Math.max(...ms)];
  const lo = Math.min(...vs), hi = Math.max(...vs), range = hi - lo || 1;
  const X = (m: number) => L + ((m - m0) / (m1 - m0 || 1)) * (W - L - 4), Y = (v: number) => T + (1 - (v - lo) / range) * (H - T - B);
  const unit = s.unit ? ` ${s.unit}` : "";
  const ticks = fullDay ? [0, 360, 720, 1080, 1440] : [m0, m1];
  // a gap (watch off) breaks the line instead of bridging it: three times the stream's usual spacing, never under 20 minutes
  const steps = pts.slice(1).map((p, i) => p[0] - pts[i][0]).sort((a, b) => a - b);
  const gap = Math.max(20, 3 * (steps[Math.floor(steps.length / 2)] ?? 0));
  const runs: [number, number][][] = [];
  for (const p of pts) { const last = runs.at(-1)?.at(-1); if (!last || p[0] - last[0] > gap) runs.push([p]); else runs.at(-1)!.push(p); }
  return `<section class="timeline"><h2>${escape(name)}</h2><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(name)} through the day">
<text x="${L - 8}" y="${Y(hi) + 4}" text-anchor="end">${escape(`${hi}${unit}`)}</text><text x="${L - 8}" y="${Y(lo) + 4}" text-anchor="end">${escape(`${lo}${unit}`)}</text>
${ticks.map((m, i) => `<text x="${X(m).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}">${hhmm(m)}</text>`).join("")}
${runs.filter((r) => r.length > 1).map((r) => `<polyline points="${r.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>`).join("")}
</svg></section>`;
}

/** A part (sleep: deep, light, rem, awake) as one bar, each field its share, with the amounts under it. */
function part(tab: Tab, row: db.Row, p: { label: string; fields: string[] }): string {
  const xs = p.fields.map((n) => ({ f: field(tab, n), v: Number(row[n]) })).filter((x) => Number.isFinite(x.v) && x.v > 0);
  const total = xs.reduce((a, x) => a + x.v, 0);
  if (!xs.length || !total) return "";
  const word = (n: string) => metricName(n).replace(new RegExp(`^${p.label} `), "");
  return `<div class="part"><span>${escape(p.label)}</span><div class="bar">${xs.map((x) => `<i style="width:${((x.v / total) * 100).toFixed(1)}%" title="${escape(word(x.f.name))}"></i>`).join("")}</div>
<div class="keys">${xs.map((x) => `<span>${escape(`${word(x.f.name)} ${amount(x.f, x.v)}`)}</span>`).join("")}</div></div>`;
}

/** A value in a row page's list: numbers in their unit ("28:22", "148 bpm"), everything else as on the row's aside. */
const detailValue = (f: Field, v: Value) => (f.type === "int" || f.type === "number" ? escape(amount(f, Number(v))) : show(f, v, f.type === "ref" ? "detail" : "aside"));

/** A day of numbers (a tab with parts: health): each section's numbers under its heading, the parts as bars, then the day's timelines. */
function sectioned(tab: Tab, row: db.Row, series: db.Series | null): string {
  const inParts = new Set((tab.parts ?? []).flatMap((p) => p.fields));
  const order = [...new Set(tab.fields.map((f) => f.section ?? ""))];
  const sections = order.map((name) => {
    const fs = tab.fields.filter((f) => (f.section ?? "") === name && f.name !== tab.title && !f.hidden && present(row[f.name]));
    const parts = (tab.parts ?? []).filter((p) => p.fields.some((n) => fs.some((f) => f.name === n))).map((p) => part(tab, row, p)).join("");
    const dl = fs.filter((f) => !inParts.has(f.name)).map((f) => `<dt>${escape(metricName(f.name))}</dt><dd>${detailValue(f, row[f.name] as Value)}</dd>`);
    if (!dl.length && !parts) return "";
    return `<section class="section">${name ? `<h2><span class="pill">${escape(name)}</span></h2>` : ""}${parts}${dl.length ? `<dl>${dl.join("")}</dl>` : ""}</section>`;
  });
  const charts = Object.entries(series ?? {}).map(([name, s]) => timeline(name, s));
  return [...sections, ...charts].filter(Boolean).join("\n");
}

export function rowPage(design: Design, tab: Tab, row: db.Row, series: db.Series | null = null): string {
  if (tab.parts?.length) {
    const body = `      <article class="detail">
      <h1>${titleOf(tab, row, "detail")}</h1>
      ${sectioned(tab, row, series)}
      </article>
      ${schemaLink(tab)}`;
    return page({ design, title: `${row[tab.title] ?? "untitled"} | senior intern`, nav: nav({ href: `/${tab.slug}`, label: tab.label }), body, css: CSS });
  }
  const shown = new Set([tab.title, ...tab.line, ...tab.aside]);
  const long = (f: Field) => f.type === "text" && present(row[f.name]) && (f.name === tab.snippet || /\n| · /.test(String(row[f.name])) || String(row[f.name]).length > 120);
  const sections = tab.fields.filter((f) => present(row[f.name]) && (f.type === "lifts" || (!shown.has(f.name) && long(f)))).map((f) => {
    const value = String(row[f.name]);
    if (f.type === "lifts") {
      const lifts = parseLifts(value);
      if (typeof lifts !== "string") {
        const sets = (l: (typeof lifts)[number]) => l.sets.map((s) => (s.load === null ? `bw × ${s.reps}` : `${s.added ? "+" : ""}${s.load} × ${s.reps}`)).join("   ");
        return `<h2>${label(f.name)} (${escape(f.unit ?? "lb")})</h2><ul class="steps">${lifts.map((l) => `<li><span class="ex">${escape(l.exercise)}</span>${escape(sets(l))}</li>`).join("")}</ul>`;
      }
    }
    const content = value.includes(" · ") ? `<ul class="steps">${value.split(" · ").map((s) => `<li>${escape(s)}</li>`).join("")}</ul>` : `<p class="prose">${escape(value)}</p>`;
    return `<h2>${label(f.name)}</h2>${content}`;
  });
  // the remaining fields: those without a section first, then each section under its heading (a run: effort, pace, zones)
  const restFields = tab.fields.filter((f) => !shown.has(f.name) && !f.hidden && f.type !== "url" && f.type !== "lifts" && !long(f) && present(row[f.name]));
  const dlOf = (fs: Field[]) => `<dl>${fs.map((f) => `<dt>${escape(metricName(f.name))}</dt><dd>${f.type === "date" || f.type === "datetime" ? show(f, row[f.name] as Value, "detail") : detailValue(f, row[f.name] as Value)}</dd>`).join("")}</dl>`;
  const rest = [...new Set(restFields.map((f) => f.section ?? ""))].map((name) => {
    const fs = restFields.filter((f) => (f.section ?? "") === name);
    return name ? `<section class="section"><h2><span class="pill">${escape(name)}</span></h2>${dlOf(fs)}</section>` : dlOf(fs);
  });
  const meta = [bits(tab, row, tab.line, "line", true), bits(tab, row, tab.aside, "aside", true)].filter(Boolean).map((m) => `<p class="meta bits">${m}</p>`).join("\n");
  const body = `      <article class="detail">
      <h1>${titleOf(tab, row, "detail")}</h1>
      ${meta}
      ${links(tab, row)}
      ${sections.join("\n")}
      ${rest.join("\n")}
      </article>
      ${schemaLink(tab)}`;
  return page({ design, title: `${row[tab.title] ?? "untitled"} | senior intern`, nav: nav({ href: `/${tab.slug}`, label: tab.label }), body, css: CSS });
}

/** One metric's history (from the tab's metrics views). */
export async function metricHistoryPage(design: Design, database: D1Database, tab: Tab, name: string): Promise<string | null> {
  const body = await metricPage(tab, database, name);
  if (!body) return null;
  return page({ design, title: `${metricName(name)} | senior intern`, nav: nav({ href: `/${tab.slug}`, label: tab.label }), body, css: CSS + LIFT_CSS });
}

/** One exercise's history (from the tab's progress view): a full chart and every session. */
export async function exercisePage(design: Design, database: D1Database, tab: Tab, exercise: string): Promise<string | null> {
  const body = await liftPage(tab, database, exercise);
  if (!body) return null;
  return page({ design, title: `${exercise} | senior intern`, nav: nav({ href: `/${tab.slug}`, label: tab.label }), body, css: CSS + LIFT_CSS });
}
