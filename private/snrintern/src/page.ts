// The human pages: a home list of tabs, one list per tab with search, and a detail view per row.
import { escape, page, type Design } from "../../../design/html.ts";
import * as db from "./db.ts";
import type { Tab } from "./schema.ts";

const CSS = `
  nav .external { margin-left: auto; }
  h1 small { color: #8a8a8a; font-size: 14px; font-weight: 380; margin-left: 10px; letter-spacing: 0; }
  .search { position: relative; margin-top: 28px; }
  .search svg { position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; stroke: #6a6a66; fill: none; stroke-width: 1.6; pointer-events: none; }
  .search input { width: 100%; background: transparent; border: 0; border-bottom: 1px solid #252522; border-radius: 0; color: #d8d4c8;
                  font: inherit; font-size: 16px; padding: 10px 0 10px 26px; outline: none; transition: border-color 220ms ease; -webkit-appearance: none; }
  .search input::placeholder { color: #5a5a56; }
  .search input:hover { border-bottom-color: #3a3a35; }
  .search input:focus { border-bottom-color: #8a8a8a; }
  .search input::-webkit-search-cancel-button { -webkit-appearance: none; }
  .search kbd { position: absolute; right: 0; top: 50%; transform: translateY(-50%); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
                color: #5a5a56; border: 1px solid #252522; border-radius: 3px; padding: 1px 6px; }
  .search input:focus + kbd { display: none; }
  .meta { color: #8a8a8a; font-size: 13px; margin-top: 12px; }
  dl { margin-top: 32px; display: grid; grid-template-columns: max-content 1fr; gap: 10px 20px; font-size: 15px; }
  dt { color: #8a8a8a; }
  dd { white-space: pre-wrap; overflow-wrap: anywhere; }
  .empty { color: #8a8a8a; margin-top: 32px; }
  @media (prefers-reduced-motion: reduce) { .search input { transition: none; } }
`;

// "/" focuses search from anywhere on a tab page, the way most search boxes on the web do.
const SLASH_TO_SEARCH = `<script>addEventListener("keydown",e=>{const i=document.querySelector(".search input");if(i&&e.key==="/"&&document.activeElement!==i){e.preventDefault();i.focus();i.select()}})</script>`;

const show = (row: db.Row, names: string[]) =>
  names.map((n) => row[n]).filter((v) => v !== undefined && v !== null && v !== "").map((v) => escape(v)).join(" · ");

/** Links only ever go somewhere else: home shows adhikrish.cloud, tab pages lead back to snrintern home. Admin sits on the right. */
function nav(current?: Tab): string {
  const left = current ? `<a href="/">snrintern</a><a href="/${current.slug}" aria-current="page">${escape(current.label)}</a>` : `<a href="https://adhikrish.cloud/">adhikrish.cloud</a>`;
  return `${left}<a class="external" href="https://admin.adhikrish.cloud/">admin</a>`;
}

export async function homePage(design: Design, database: D1Database): Promise<string> {
  const [tabs, counts] = await Promise.all([db.tabs(database), db.counts(database)]);
  const items = tabs.map((tab) => {
    const n = counts.get(tab.slug) ?? 0;
    return `          <li>
            <a href="/${tab.slug}"><span>${escape(tab.label)}</span><small>${n} ${n === 1 ? "row" : "rows"}</small></a>
            <p>${escape(tab.about)}</p>
          </li>`;
  });
  const body = `      <h1>snrintern</h1>
      <ul class="project-list">
${items.join("\n")}
      </ul>`;
  return page({ design, title: "snrintern", nav: nav(), body, css: CSS });
}

export async function tabPage(design: Design, database: D1Database, tab: Tab, q: string): Promise<string> {
  const rows = await db.list(database, tab, { q: q || undefined, limit: 1000 });
  const items = rows.map((row) => `          <li>
            <a href="/${tab.slug}/${row.id}"><span>${escape(row[tab.title] ?? "untitled")}</span><small>${show(row, tab.aside)}</small></a>
            <p>${show(row, tab.line)}</p>
          </li>`);
  const icon = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>`;
  const body = `      <h1>${escape(tab.label)}<small>${q ? `${rows.length} matching` : `${rows.length} ${rows.length === 1 ? "row" : "rows"}`}</small></h1>
      <form class="search" action="/${tab.slug}" role="search">${icon}<input type="search" name="q" value="${escape(q)}" placeholder="search ${escape(tab.label)}" aria-label="search ${escape(tab.label)}" autocomplete="off" spellcheck="false"><kbd>/</kbd></form>
${rows.length ? `      <ul class="project-list">\n${items.join("\n")}\n      </ul>` : `      <p class="empty">nothing${q ? ` matches "${escape(q)}"` : " yet"}.</p>`}
      ${SLASH_TO_SEARCH}`;
  return page({ design, title: `${tab.label} | snrintern`, nav: nav(tab), body, css: CSS });
}

export function rowPage(design: Design, tab: Tab, row: db.Row): string {
  const fields = tab.fields
    .filter((f) => f.name !== tab.title && row[f.name] !== undefined && row[f.name] !== "")
    .map((f) => {
      const value = escape(row[f.name]);
      const shown = f.type === "url" ? `<a href="${value}" target="_blank" rel="noopener noreferrer">${value}</a>` : value;
      return `        <dt>${f.name.replaceAll("_", " ")}</dt><dd>${shown}</dd>`;
    });
  const body = `      <h1>${escape(row[tab.title] ?? "untitled")}</h1>
      <p class="meta">updated ${escape(String(row.updated_at).slice(0, 10))} by ${escape(row.updated_by)}</p>
      <dl>
${fields.join("\n")}
      </dl>`;
  return page({ design, title: `${row[tab.title] ?? "untitled"} | snrintern`, nav: nav(tab), body, css: CSS });
}
