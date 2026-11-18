// The read-only pages: home (the tabs), a tab (its views, then a searchable list), a row (everything about it).
// Everything comes from the tab definition, so a tab added through the api gets the same layout.
import { escape, page, type Design } from "../../../design/html.ts";
import * as db from "./db.ts";
import { parseLifts, type Field, type Tab, type Value } from "./schema.ts";
import { LIFT_CSS, liftPage, renderViews, VIEW_CSS } from "./views.ts";

const CSS = `
  nav { flex-wrap: wrap; row-gap: 6px; }
  nav .external { margin-left: auto; }
  .search { position: relative; margin-top: 28px; }
  .search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; stroke: #6a6a66; fill: none; stroke-width: 1.6; pointer-events: none; }
  .search input { width: 100%; background: #121210; border: 0; border-radius: 8px; color: #d8d4c8;
                  font: inherit; font-size: 16px; padding: 10px 40px 10px 36px; outline: none; transition: background 220ms ease; -webkit-appearance: none; }
  .search input::placeholder { color: #5a5a56; }
  .search input:hover, .search input:focus { background: #181816; }
  .search input::-webkit-search-cancel-button { -webkit-appearance: none; }
  .search kbd { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #5a5a56; }
  .search input:focus + kbd { display: none; }
  .project-list { margin-top: 24px; }
  .project-list li + li { margin-top: 26px; }
  .project-list a.head { padding-block: 0; }
  .bits { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; }
  .project-list .line { color: #8a8a8a; font-size: 14px; margin-top: 4px; }
  .project-list .snippet { color: #a9a59a; font-size: 14px; line-height: 1.6; margin-top: 6px;
                           display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .links { margin-top: 6px; font-size: 13px; display: flex; gap: 16px; flex-wrap: wrap; }
  .links a, .project-list .links a { display: inline; padding: 0; color: #8a8a8a; }
  .aside { display: inline-flex; gap: 12px; align-items: baseline; font-size: 13px; }
  .meta { color: #8a8a8a; font-size: 14px; margin-top: 10px; }
  .detail h2 { font-size: 13px; font-weight: 450; color: #8a8a8a; margin-top: 32px; }
  .prose { margin-top: 8px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
  .steps { margin-top: 8px; list-style: none; line-height: 1.8; }
  .steps .ex { color: #8a8a8a; display: inline-block; min-width: 180px; }
  dl { margin-top: 32px; display: grid; grid-template-columns: max-content 1fr; gap: 8px 20px; font-size: 15px; }
  dt { color: #8a8a8a; }
  dd { overflow-wrap: anywhere; }
  .views + .search { margin-top: 48px; }
  .searching .views { display: none; }
  .empty { color: #8a8a8a; margin-top: 32px; }
  .day { margin-top: 36px; }
  .day h2 { font-size: 15px; font-weight: 450; color: #d8d4c8; }
  .day h2 small { color: #6a6a66; font-weight: 380; margin-left: 10px; }
  .day .project-list { margin-top: 12px; }
  .day .project-list li + li { margin-top: 18px; }
  details.group summary { list-style: none; cursor: pointer; font-size: 17px; padding: 10px 0; }
  details.group summary::-webkit-details-marker { display: none; }
  details.group summary::before { content: "›"; color: #6a6a66; display: inline-block; width: 18px; transition: transform 220ms ease; }
  details.group[open] summary::before { transform: rotate(90deg); }
  details.group .project-list { margin: 4px 0 18px 18px; }
  a.schema { display: inline-block; margin-top: 64px; color: #3a3a35; font-size: 12px; }
  a.schema:hover { color: #8a8a8a; }
  @media (prefers-reduced-motion: reduce) { .search input, details.group summary::before { transition: none; } }
`;

// Live search: the rows are already on the page, so typing hides the ones that don't match (every field counts).
// "/" focuses the box; pressing enter runs the same search on the server.
const LIVE_SEARCH = `<script>(()=>{const i=document.querySelector(".search input");if(!i)return;
const rows=[...document.querySelectorAll(".rows li")],text=rows.map(r=>r.dataset.search),none=document.querySelector(".none");
const run=()=>{const q=i.value.trim().toLowerCase();let shown=0;rows.forEach((r,k)=>{const ok=!q||text[k].includes(q);r.hidden=!ok;if(ok)shown++});
document.querySelectorAll(".rows section,.rows details").forEach(s=>{const any=[...s.querySelectorAll("li")].some(r=>!r.hidden);s.hidden=!any;if(s.tagName==="DETAILS")s.open=!!q&&any});
document.body.classList.toggle("searching",!!q);if(none)none.hidden=!q||shown>0};
i.addEventListener("input",run);run();
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
 * aside (right of a row): short dates, numbers with units, enums as a pill or a green/red word.
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
    case "number": return escape(f.unit ? `${value}${f.unit === "%" ? "" : " "}${f.unit}` : where === "aside" ? String(value) : `${label(f.name)} ${value}`);
    case "enum": {
      const tone = f.colors?.[String(value)];
      return tone ? `<span class="${tone}">${escape(value)}</span>` : `<span class="pill">${escape(value)}</span>`;
    }
    case "url": return `<a href="${escape(value)}" target="_blank" rel="noopener noreferrer">${escape(site(String(value)))} ↗</a>`;
    case "lifts": {
      const lifts = parseLifts(String(value));
      return escape(typeof lifts === "string" ? value : lifts.map((l) => l.exercise).join(", "));
    }
    default: return escape(value);
  }
}

const bits = (tab: Tab, row: db.Row, names: string[], where: "aside" | "line") =>
  names.filter((n) => present(row[n])).map((n) => `<span>${show(field(tab, n), row[n] as Value, where)}</span>`).join("");
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

/** No nav on home. Elsewhere: snr intern home and the visible tabs on the left (not the page you're on), admin on the right. */
function nav(tabs: Tab[], current?: Tab, onRow = false): string {
  if (!current) return "";
  const others = tabs.filter((t) => !t.hidden && (onRow || t.slug !== current.slug)).map((t) => `<a href="/${t.slug}">${escape(t.label)}</a>`).join("");
  return `<a href="/">snr intern</a>${others}<a class="external" href="https://admin.adhikrish.cloud/">admin</a>`;
}
const schemaLink = (tab: Tab) => `<a class="schema" href="/api/_tabs/${tab.slug}">schema</a>`;

export async function homePage(design: Design, database: D1Database): Promise<string> {
  const tabs = (await db.tabs(database)).filter((t) => !t.hidden);
  const items = tabs.map((tab) => `          <li>
            <a href="/${tab.slug}"><span>${escape(tab.label)}</span></a>
            <p>${escape(tab.about)}</p>
          </li>`);
  const body = `      <h1>snr intern</h1>
      <ul class="project-list">
${items.join("\n")}
      </ul>`;
  return page({ design, title: "snr intern", nav: nav(tabs), body, css: CSS });
}

export async function tabPage(design: Design, database: D1Database, tab: Tab, q: string): Promise<string> {
  const [tabs, rows, views] = await Promise.all([
    db.tabs(database),
    db.list(database, tab, { q: q || undefined, limit: 1000 }),
    q ? Promise.resolve("") : renderViews(tab, database),
  ]);
  const groupBy = tab.group ? field(tab, tab.group) : undefined;
  const byDay = groupBy && (groupBy.type === "date" || groupBy.type === "datetime") ? groupBy : undefined;
  const item = (row: db.Row) => {
    // inside a day group the day is the heading, so the row shows only its time
    const time = byDay && present(row[byDay.name]) ? clock(parse(String(row[byDay.name]))!) : "";
    const aside = [time && `<span>${escape(time)}</span>`, bits(tab, row, tab.aside.filter((n) => n !== byDay?.name), "aside")].join("");
    const line = bits(tab, row, tab.line, "line");
    const snippet = tab.snippet && present(row[tab.snippet]) ? `\n            <p class="snippet">${escape(row[tab.snippet])}</p>` : "";
    const searchable = tab.fields.map((f) => row[f.name]).filter(present).join(" ").toLowerCase();
    return `          <li data-search="${escape(searchable)}">
            <a class="head" href="/${tab.slug}/${row.id}"><span>${titleOf(tab, row, "aside")}</span><small class="aside">${aside}</small></a>${line ? `\n            <p class="line bits">${line}</p>` : ""}${snippet}
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
      const heading = p ? `${day(p, "long").replace(`, ${new Date().getUTCFullYear()}`, "")}<small>${relative(p)}</small>` : "no date";
      return `<section class="day"><h2>${heading}</h2>${ul(dayRows)}</section>`;
    }).join("\n");
  } else if (groupBy) {
    // grouped by value, collapsed: enum options in order, free text largest first, then rows without one
    const size = new Map<string, number>();
    for (const r of rows) size.set(String(r[groupBy.name] ?? ""), (size.get(String(r[groupBy.name] ?? "")) ?? 0) + 1);
    const keys = groupBy.type === "enum" ? [...groupBy.options!, ""] : [...size.keys()].filter(Boolean).sort((a, b) => size.get(b)! - size.get(a)! || a.localeCompare(b)).concat("");
    list = keys.filter((key) => size.get(key)).map((key) =>
      `<details class="group"><summary>${escape(key || `no ${label(groupBy.name)}`)}</summary>${ul(rows.filter((r) => String(r[groupBy.name] ?? "") === key))}</details>`).join("\n");
  } else list = ul(rows);
  const icon = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>`;
  const body = `      <h1>${escape(tab.label)}</h1>
${views ? `      ${views}\n` : ""}      <form class="search" action="/${tab.slug}" role="search">${icon}<input type="search" name="q" value="${escape(q)}" placeholder="search ${escape(tab.label)}" aria-label="search ${escape(tab.label)}" autocomplete="off" spellcheck="false"><kbd>/</kbd></form>
${rows.length ? `      <div class="rows">\n${list}\n      </div>\n      <p class="empty none" hidden>nothing matches.</p>` : `      <p class="empty">nothing${q ? ` matches "${escape(q)}"` : " yet"}.</p>`}
      ${schemaLink(tab)}
      ${LIVE_SEARCH}`;
  return page({ design, title: `${tab.label} | snr intern`, nav: nav(tabs, tab), body, css: CSS + VIEW_CSS });
}

export async function rowPage(design: Design, database: D1Database, tab: Tab, row: db.Row): Promise<string> {
  const tabs = await db.tabs(database);
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
  const rest = tab.fields.filter((f) => !shown.has(f.name) && f.type !== "url" && f.type !== "lifts" && !long(f) && present(row[f.name]))
    .map((f) => `<dt>${label(f.name)}</dt><dd>${show(f, row[f.name] as Value, "detail")}</dd>`);
  const meta = [bits(tab, row, tab.line, "line"), bits(tab, row, tab.aside, "aside")].filter(Boolean).map((m) => `<p class="meta bits">${m}</p>`).join("\n");
  const body = `      <article class="detail">
      <h1>${titleOf(tab, row, "detail")}</h1>
      ${meta}
      ${links(tab, row)}
      ${sections.join("\n")}
      ${rest.length ? `<dl>${rest.join("")}</dl>` : ""}
      </article>
      ${schemaLink(tab)}`;
  return page({ design, title: `${row[tab.title] ?? "untitled"} | snr intern`, nav: nav(tabs, tab, true), body, css: CSS });
}

/** One exercise's history (from the tab's progress view): a full chart and every session. */
export async function exercisePage(design: Design, database: D1Database, tab: Tab, exercise: string): Promise<string | null> {
  const body = await liftPage(tab, database, exercise);
  if (!body) return null;
  const tabs = await db.tabs(database);
  return page({ design, title: `${exercise} | snr intern`, nav: nav(tabs, tab, true), body, css: CSS + LIFT_CSS });
}
