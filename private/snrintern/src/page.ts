// The human pages: home (a list of tabs), a tab (a readable list with search), a row (everything about it).
// Everything is driven by the tab definition, so a tab added through the api gets the same layout.
import { escape, page, type Design } from "../../../design/html.ts";
import * as db from "./db.ts";
import { parseLifts, type Field, type Tab, type Value } from "./schema.ts";
import { renderViews, VIEW_CSS } from "./views.ts";

const CSS = `
  nav { flex-wrap: wrap; row-gap: 6px; }
  nav .external { margin-left: auto; }
  nav a[aria-current] { color: #d8d4c8; }
  h1 small { color: #8a8a8a; font-size: 14px; font-weight: 380; margin-left: 10px; letter-spacing: 0; }
  .tally { color: #8a8a8a; font-size: 14px; margin-top: 6px; }
  .search { position: relative; margin-top: 24px; }
  .search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; stroke: #6a6a66; fill: none; stroke-width: 1.6; pointer-events: none; }
  .search input { width: 100%; background: #121210; border: 0; border-radius: 8px; color: #d8d4c8;
                  font: inherit; font-size: 16px; padding: 10px 40px 10px 36px; outline: none; transition: background 220ms ease; -webkit-appearance: none; }
  .search input::placeholder { color: #5a5a56; }
  .search input:hover, .search input:focus { background: #181816; }
  .search input::-webkit-search-cancel-button { -webkit-appearance: none; }
  .search kbd { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
                color: #5a5a56; border: 1px solid #252522; border-radius: 3px; padding: 1px 6px; }
  .search input:focus + kbd { display: none; }
  .project-list { margin-top: 28px; }
  .project-list li + li { margin-top: 28px; }
  .project-list a.head { padding-block: 0; }
  .project-list .line { color: #8a8a8a; font-size: 14px; margin-top: 4px; }
  .project-list .snippet { color: #a9a59a; font-size: 14px; line-height: 1.6; margin-top: 6px;
                           display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .links { margin-top: 6px; font-size: 13px; display: flex; gap: 14px; flex-wrap: wrap; }
  .links a, .project-list .links a { display: inline; padding: 0; color: #8a8a8a; }
  .links a:hover { color: #d8d4c8; }
  .tag { display: inline-block; font-size: 12px; line-height: 1.5; padding: 0 7px; border: 1px solid #2e2e2a; border-radius: 10px; color: #a9a59a; white-space: nowrap; }
  .aside { display: inline-flex; gap: 8px; align-items: baseline; }
  .project-list .aside span { text-decoration: none; }
  .meta { color: #8a8a8a; font-size: 14px; margin-top: 8px; }
  .detail h2 { font-size: 13px; font-weight: 450; color: #8a8a8a; margin-top: 32px; }
  .prose { margin-top: 8px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
  .steps { margin-top: 8px; list-style: none; line-height: 1.7; }
  .steps li + li { margin-top: 2px; }
  .steps .ex { color: #8a8a8a; display: inline-block; min-width: 170px; }
  .detail h2 small { color: #5a5a56; }
  dl { margin-top: 32px; display: grid; grid-template-columns: max-content 1fr; gap: 8px 20px; font-size: 15px; }
  dt { color: #8a8a8a; }
  dd { overflow-wrap: anywhere; }
  .updated { color: #6a6a66; font-size: 13px; margin-top: 40px; }
  .views + .search { margin-top: 44px; }
  .searching .views, .searching .tally { display: none; }
  .empty { color: #8a8a8a; margin-top: 32px; }
  .day { margin-top: 36px; }
  .day h2 { font-size: 15px; font-weight: 450; color: #d8d4c8; }
  .day h2 small { color: #6a6a66; font-weight: 380; margin-left: 8px; }
  .day .project-list { margin-top: 14px; }
  .day .project-list li + li { margin-top: 18px; }
  details.group { margin-top: 6px; }
  details.group summary { list-style: none; cursor: pointer; font-size: 17px; padding: 10px 0; display: flex; align-items: baseline; gap: 10px; }
  details.group summary::-webkit-details-marker { display: none; }
  details.group summary::before { content: "›"; color: #6a6a66; display: inline-block; width: 10px; transition: transform 220ms ease; }
  details.group[open] summary::before { transform: rotate(90deg); }
  details.group summary small { color: #6a6a66; font-size: 13px; }
  details.group .project-list { margin: 6px 0 18px 20px; }
  @media (prefers-reduced-motion: reduce) { .search input { transition: none; } }
`;

// "/" focuses search from anywhere on a tab page, the way most search boxes on the web do.
// Live search: rows are already on the page, so typing just hides the ones that don't match.
// "/" focuses the box. Pressing enter still runs the same search on the server.
const LIVE_SEARCH = `<script>(()=>{const i=document.querySelector(".search input"),n=document.querySelector("h1 small");if(!i)return;
const rows=[...document.querySelectorAll(".rows li")],total=rows.length,text=rows.map(r=>r.dataset.search),none=document.querySelector(".none");
const run=()=>{const q=i.value.trim().toLowerCase();let shown=0;rows.forEach((r,k)=>{const ok=!q||text[k].includes(q);r.hidden=!ok;if(ok)shown++});
document.querySelectorAll(".rows section,.rows details").forEach(s=>{const any=[...s.querySelectorAll("li")].some(r=>!r.hidden);s.hidden=!any;if(s.tagName==="DETAILS")s.open=!!q&&any});
document.body.classList.toggle("searching",!!q);if(n)n.textContent=q?shown+" of "+total:total;if(none)none.hidden=!q||shown>0};
i.addEventListener("input",run);run();
addEventListener("keydown",e=>{if(e.key==="/"&&document.activeElement!==i){e.preventDefault();i.focus();i.select()}})})()</script>`;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const label = (name: string) => name.replaceAll("_", " ");

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
type Parts = { y: number; mo: number; d: number; h?: number; mi?: string };
const parse = (value: string): Parts | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: m[4] === undefined ? undefined : Number(m[4]), mi: m[5] } : null;
};
const clock = (p: Parts) => (p.h === undefined ? "" : `${p.h % 12 || 12}:${p.mi} ${p.h < 12 ? "am" : "pm"}`);

/** The calendar day as written (no timezone shift). "sep 17" this year, "jun 25, 2025" otherwise; "long" adds the weekday and year. */
function day(p: Parts, style: "short" | "long", now = new Date()): string {
  const base = `${MONTHS[p.mo - 1]} ${p.d}`;
  if (style === "long") return `${DAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()]}, ${base}, ${p.y}`;
  return p.y === now.getUTCFullYear() ? base : `${base}, ${p.y}`;
}

/** "today", "yesterday", "3 weeks ago", "in 2 years", counted in whole calendar days from today (utc). */
function relative(p: Parts, now = new Date()): string {
  const days = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  const n = Math.abs(days);
  const [count, unit] = n < 14 ? [n, "day"] : n < 60 ? [Math.round(n / 7), "week"] : n < 730 ? [Math.round(n / 30.44), "month"] : [Math.round(n / 365.25), "year"];
  const span = `${count} ${unit}${count === 1 ? "" : "s"}`;
  return days < 0 ? `${span} ago` : `in ${span}`;
}

/** Lists: "sep 17, 9:38 pm". Detail: "wed, sep 17, 2026, 9:38 pm · 2 months ago". */
function when(value: string, style: "short" | "long" = "short"): string {
  const p = parse(value);
  if (!p) return value;
  const text = [day(p, style), clock(p)].filter(Boolean).join(", ");
  return style === "long" ? `${text} · ${relative(p)}` : text;
}

/** "https://www.linkedin.com/in/x" -> "linkedin"; "https://x.com/y" -> "x". */
const site = (url: string) => {
  try { const parts = new URL(url).hostname.replace(/^www\./, "").split("."); return parts.length > 1 ? parts.at(-2)! : parts[0]; } catch { return "link"; }
};

const present = (v: Value | undefined): v is Value => v !== undefined && v !== null && v !== "";

/** One value, formatted for where it appears. In a row's muted line, dates and plain numbers carry their field name. */
function show(field: Field, value: Value, where: "aside" | "line" | "detail"): string {
  switch (field.type) {
    case "date":
    case "datetime": return escape(where === "line" ? `${label(field.name)} ${when(String(value))}` : when(String(value), where === "detail" ? "long" : "short"));
    case "int":
    case "number": return escape(field.unit ? `${value}${field.unit === "%" ? "" : " "}${field.unit}` : where === "line" ? `${label(field.name)} ${value}` : String(value));
    case "lifts": {
      const lifts = parseLifts(String(value));
      return typeof lifts === "string" ? escape(value) : escape(lifts.map((l) => l.exercise).join(", "));
    }
    case "enum": return where === "aside" ? `<span class="tag">${escape(value)}</span>` : escape(value);
    case "url": return `<a href="${escape(value)}" target="_blank" rel="noopener noreferrer">${escape(site(String(value)))}</a>`;
    default: return escape(value);
  }
}

const field = (tab: Tab, name: string) => tab.fields.find((f) => f.name === name)!;
const joined = (tab: Tab, row: db.Row, names: string[], where: "aside" | "line") =>
  names.filter((n) => present(row[n])).map((n) => show(field(tab, n), row[n] as Value, where)).join(where === "aside" ? " " : " · ");
const links = (tab: Tab, row: db.Row) => {
  const urls = tab.fields.filter((f) => f.type === "url" && present(row[f.name]) && !tab.aside.includes(f.name) && !tab.line.includes(f.name));
  return urls.length ? `<p class="links">${urls.map((f) => `<a href="${escape(row[f.name])}" target="_blank" rel="noopener noreferrer">${escape(site(String(row[f.name])))} ↗</a>`).join("")}</p>` : "";
};
/** A row's title, formatted by its field type (a date title reads "sep 17", or the full date on its own page). */
const titleOf = (tab: Tab, row: db.Row, where: "aside" | "detail" = "aside") => {
  const f = field(tab, tab.title), v = row[tab.title];
  if (!present(v)) return "untitled";
  return f.type === "text" || f.type === "enum" ? escape(v) : show(f, v, where).replace(/<[^>]+>/g, "");
};
const who = (by: unknown) => (String(by).startsWith("service:") ? "an agent" : String(by));

/** snrintern home and the tabs on the left (the page you're on is not a link), admin on the right. */
function nav(tabs: Tab[], current?: Tab, onRow = false): string {
  if (!current) return `<a href="https://adhikrish.cloud/">adhikrish.cloud</a><a class="external" href="https://admin.adhikrish.cloud/">admin</a>`;
  const others = tabs.filter((t) => onRow || t.slug !== current.slug)
    .map((t) => `<a href="/${t.slug}"${t.slug === current.slug ? ' aria-current="page"' : ""}>${escape(t.label)}</a>`).join("");
  return `<a href="/">snr intern</a>${others}<a class="external" href="https://admin.adhikrish.cloud/">admin</a>`;
}

export async function homePage(design: Design, database: D1Database): Promise<string> {
  const [tabs, counts] = await Promise.all([db.tabs(database), db.counts(database)]);
  const items = tabs.map((tab) => {
    const n = counts.get(tab.slug) ?? 0;
    return `          <li>
            <a href="/${tab.slug}"><span>${escape(tab.label)}</span><small>${n}</small></a>
            <p>${escape(tab.about)}</p>
          </li>`;
  });
  const body = `      <h1>snr intern</h1>
      <ul class="project-list">
${items.join("\n")}
      </ul>
`;
  return page({ design, title: "snr intern", nav: nav(tabs), body, css: CSS });
}

export async function tabPage(design: Design, database: D1Database, tab: Tab, q: string): Promise<string> {
  const [tabs, rows, total, tallies, views] = await Promise.all([
    db.tabs(database),
    db.list(database, tab, { q: q || undefined, limit: 1000 }),
    db.count(database, tab.slug),
    Promise.all((tab.summary ?? []).map((name) => db.tally(database, tab.slug, name))),
    q ? Promise.resolve("") : renderViews(tab, database),
  ]);
  const groupBy = tab.group ? field(tab, tab.group) : undefined;
  const byValue = groupBy && (groupBy.type === "enum" || groupBy.type === "text");
  const groupField = groupBy && !byValue ? groupBy : undefined; // grouped by day
  const item = (row: db.Row) => {
    // inside a day group the day is in the heading, so a row only shows its time
    const asideNames = groupField ? tab.aside.filter((n) => n !== groupField.name) : tab.aside;
    const time = groupField && present(row[groupField.name]) ? clock(parse(String(row[groupField.name]))!) : "";
    const aside = [time && escape(time), joined(tab, row, asideNames, "aside")].filter(Boolean).join(" ");
    const line = joined(tab, row, tab.line, "line");
    const snippet = tab.snippet && present(row[tab.snippet]) ? `\n            <p class="snippet">${escape(row[tab.snippet])}</p>` : "";
    // every value, so live search matches the same things the server search does
    const searchable = tab.fields.map((f) => row[f.name]).filter(present).join(" ").toLowerCase();
    return `          <li data-search="${escape(searchable)}">
            <a class="head" href="/${tab.slug}/${row.id}"><span>${titleOf(tab, row)}</span><small class="aside">${aside}</small></a>${line ? `\n            <p class="line">${line}</p>` : ""}${snippet}
            ${links(tab, row)}
          </li>`;
  };
  let list: string;
  if (byValue) {
    // grouped by value, collapsed: enum options in their listed order, free text by size, then rows without one
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(String(r[groupBy.name] ?? ""), (counts.get(String(r[groupBy.name] ?? "")) ?? 0) + 1);
    const keys = groupBy.type === "enum" ? [...groupBy.options!, ""] : [...counts.keys()].filter(Boolean).sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b)).concat("");
    list = keys.filter((key) => counts.get(key)).map((key) => {
      const inGroup = rows.filter((r) => String(r[groupBy.name] ?? "") === key);
      return `      <details class="group">\n        <summary>${escape(key || `no ${label(groupBy.name)}`)}<small>${inGroup.length}</small></summary>\n        <ul class="project-list">\n${inGroup.map(item).join("\n")}\n        </ul>\n      </details>`;
    }).join("\n");
  } else if (groupField) {
    const days = new Map<string, db.Row[]>();
    for (const row of rows) {
      const key = present(row[groupField.name]) ? String(row[groupField.name]).slice(0, 10) : "no date";
      days.set(key, [...(days.get(key) ?? []), row]);
    }
    list = [...days].map(([key, dayRows]) => {
      const p = parse(key);
      const heading = p ? `${day(p, "long").replace(`, ${new Date().getUTCFullYear()}`, "")}<small>${relative(p)}</small>` : key;
      return `      <section class="day">\n        <h2>${heading}</h2>\n        <ul class="project-list">\n${dayRows.map(item).join("\n")}\n        </ul>\n      </section>`;
    }).join("\n");
  } else list = `      <ul class="project-list">\n${rows.map(item).join("\n")}\n      </ul>`;
  const tally = tallies.flat().map(([v, n]) => `${n} ${escape(v)}`).join(" · ");
  const icon = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>`;
  const body = `      <h1>${escape(tab.label)}<small>${q ? `${rows.length} of ${total}` : total}</small></h1>
${tally ? `      <p class="tally">${tally}</p>\n` : ""}${views ? `      ${views}\n` : ""}      <form class="search" action="/${tab.slug}" role="search">${icon}<input type="search" name="q" value="${escape(q)}" placeholder="search ${escape(tab.label)}" aria-label="search ${escape(tab.label)}" autocomplete="off" spellcheck="false"><kbd>/</kbd></form>
${rows.length ? `      <div class="rows">\n${list}\n      </div>\n      <p class="empty none" hidden>nothing matches.</p>` : `      <p class="empty">nothing${q ? ` matches "${escape(q)}"` : " yet"}.</p>`}
      ${LIVE_SEARCH}`;
  return page({ design, title: `${tab.label} | snr intern`, nav: nav(tabs, tab), body, css: CSS + VIEW_CSS });
}

export async function rowPage(design: Design, database: D1Database, tab: Tab, row: db.Row): Promise<string> {
  const tabs = await db.tabs(database);
  const shown = new Set([tab.title, ...tab.line, ...tab.aside]);
  const long = (f: Field) => f.type === "text" && present(row[f.name]) && (f.name === tab.snippet || /\n| · /.test(String(row[f.name])) || String(row[f.name]).length > 120);
  const liftSections = tab.fields.filter((f) => f.type === "lifts" && present(row[f.name])).map((f) => {
    const lifts = parseLifts(String(row[f.name]));
    if (typeof lifts === "string") return `      <h2>${label(f.name)}</h2>\n      <p class="prose">${escape(row[f.name])}</p>`;
    const unit = f.unit ?? "lb";
    const sets = (l: (typeof lifts)[number]) => l.sets.map((st) => (st.load === null ? `bw×${st.reps}` : `${st.added ? "+" : ""}${st.load}×${st.reps}`)).join(", ");
    return `      <h2>${label(f.name)} <small>(${escape(unit)})</small></h2>\n      <ul class="steps">${lifts.map((l) => `<li><span class="ex">${escape(l.exercise)}</span> ${escape(sets(l))}</li>`).join("")}</ul>`;
  });
  const sections = tab.fields.filter((f) => !shown.has(f.name) && long(f)).map((f) => {
    const value = String(row[f.name]);
    const content = value.includes(" · ")
      ? `<ul class="steps">${value.split(" · ").map((s) => `<li>${escape(s)}</li>`).join("")}</ul>`
      : `<p class="prose">${escape(value)}</p>`;
    return `      <h2>${label(f.name)}</h2>\n      ${content}`;
  });
  const rest = tab.fields.filter((f) => !shown.has(f.name) && f.type !== "url" && f.type !== "lifts" && !long(f) && present(row[f.name]))
    .map((f) => `        <dt>${label(f.name)}</dt><dd>${show(f, row[f.name] as Value, "detail")}</dd>`);
  const line = joined(tab, row, tab.line, "line");
  const aside = tab.aside.filter((n) => present(row[n])).map((n) => show(field(tab, n), row[n] as Value, "detail")).join(" · ");
  const body = `      <article class="detail">
      <h1>${titleOf(tab, row, "detail").split(" · ")[0]}</h1>
${[line, aside].filter(Boolean).map((m) => `      <p class="meta">${m}</p>`).join("\n")}
      ${links(tab, row)}
${[...liftSections, ...sections].join("\n")}
${rest.length ? `      <dl>\n${rest.join("\n")}\n      </dl>` : ""}
      <p class="updated">updated ${escape(when(String(row.updated_at).slice(0, 10)))} by ${escape(who(row.updated_by))}</p>
      </article>`;
  return page({ design, title: `${row[tab.title] ?? "untitled"} | snr intern`, nav: nav(tabs, tab, true), body, css: CSS });
}
