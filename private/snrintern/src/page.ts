// The human page: tab names across the top, one plain list per tab, a detail view per row.
import { escape, page, type Design } from "../../../design/html.ts";
import * as db from "./db.ts";
import { TABS, type Tab } from "./tabs.ts";

const CSS = `
  nav a[aria-current] { color: #d8d4c8; text-decoration: none; }
  .search { margin-top: 24px; }
  .search input { width: 100%; background: #121210; border: 1px solid #252522; color: #d8d4c8; font: inherit; font-size: 15px; padding: 8px 10px; border-radius: 3px; }
  dl { margin-top: 32px; display: grid; grid-template-columns: max-content 1fr; gap: 10px 20px; font-size: 15px; }
  dt { color: #8a8a8a; }
  dd { white-space: pre-wrap; overflow-wrap: anywhere; }
  .empty { color: #8a8a8a; margin-top: 32px; }
`;

const show = (row: db.Row, names: string[]) =>
  names.map((n) => row[n]).filter((v) => v !== null && v !== "").map((v) => escape(v)).join(" · ");

function nav(current?: Tab): string {
  return TABS.map((t) => `<a href="/${t.slug}"${t === current ? ' aria-current="page"' : ""}>${t.label}</a>`).join("");
}

export async function tabPage(design: Design, database: D1Database, tab: Tab, q: string): Promise<string> {
  const rows = await db.list(database, tab, { q: q || undefined, limit: 1000 });
  const items = rows.map((row) => `          <li>
            <a href="/${tab.slug}/${row.id}"><span>${escape(row[tab.title] ?? "untitled")}</span><small>${show(row, tab.aside)}</small></a>
            <p>${show(row, tab.line)}</p>
          </li>`);
  const body = `      <form class="search" action="/${tab.slug}"><input name="q" value="${escape(q)}" placeholder="search ${tab.label}" aria-label="search ${tab.label}"></form>
${rows.length ? `      <ul class="project-list">\n${items.join("\n")}\n      </ul>` : `      <p class="empty">nothing${q ? ` matches "${escape(q)}"` : " yet"}.</p>`}`;
  return page({ design, title: `${tab.label} | snrintern`, nav: nav(tab), body, css: CSS });
}

export function rowPage(design: Design, tab: Tab, row: db.Row): string {
  const fields = tab.fields
    .filter((f) => f.name !== tab.title && row[f.name] !== null && row[f.name] !== "")
    .map((f) => `        <dt>${f.name.replaceAll("_", " ")}</dt><dd>${escape(row[f.name])}</dd>`);
  const body = `      <h1>${escape(row[tab.title] ?? "untitled")}</h1>
      <dl>
${fields.join("\n")}
        <dt>updated</dt><dd>${escape(row.updated_at)} by ${escape(row.updated_by)}</dd>
      </dl>`;
  return page({ design, title: `${row[tab.title] ?? "untitled"} | snrintern`, nav: nav(tab), body, css: CSS });
}
