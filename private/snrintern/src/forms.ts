// Everything the agent can do through the api, a person can do through these pages:
//   /<tab>/_new               add a row          /_new                 add a tab
//   /<tab>/<id>/_edit         edit a row         /<tab>/_schema        edit a tab's definition (json)
//   /<tab>/<id>/_delete       delete a row       /<tab>/_schema/delete delete an empty tab
//   /<tab>/<id>/_set          change only the posted fields (one-click buttons like scoring a forecast)
// Forms post back to the same path. The same checks as the api run (src/schema.ts), and schema changes
// land in the same log. A form post must come from this site (Origin header), so another site can't submit one.
import { escape, page, type Design } from "../../../design/html.ts";
import * as db from "./db.ts";
import { checkDefinition, checkRow, SLUG, type Field, type Tab } from "./schema.ts";

const CSS = `
  nav { flex-wrap: wrap; row-gap: 6px; }
  nav .external { margin-left: auto; }
  form.edit { margin-top: 28px; display: grid; gap: 18px; }
  form.edit label { display: grid; gap: 6px; font-size: 13px; color: #8a8a8a; }
  form.edit label b { font-weight: 450; color: #d8d4c8; margin-left: 4px; }
  form.edit input, form.edit select, form.edit textarea { width: 100%; background: #0e0e0c; border: 1px solid #252522; border-radius: 4px; color: #d8d4c8;
    font: inherit; font-size: 15px; padding: 8px 10px; outline: none; transition: border-color 220ms ease; }
  form.edit textarea { min-height: 120px; resize: vertical; line-height: 1.6; }
  form.edit textarea.json { min-height: 420px; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  form.edit input:focus, form.edit select:focus, form.edit textarea:focus { border-color: #8a8a8a; }
  .row-input { display: flex; gap: 8px; }
  .row-input button { flex: none; }
  .actions { display: flex; gap: 12px; align-items: center; margin-top: 6px; }
  button { background: #d8d4c8; color: #080807; border: 0; border-radius: 4px; font: inherit; font-size: 14px; font-weight: 450; padding: 8px 16px; cursor: pointer; }
  button.quiet { background: transparent; color: #8a8a8a; border: 1px solid #252522; }
  button.danger { background: transparent; color: #c4553f; border: 1px solid #3a3a35; }
  .actions a { color: #8a8a8a; font-size: 14px; }
  .error { color: #c4553f; font-size: 14px; margin-top: 20px; border-left: 2px solid #c4553f; padding-left: 10px; }
  .hint { color: #6a6a66; font-size: 13px; margin-top: 8px; }
  .danger-zone { margin-top: 48px; padding-top: 20px; border-top: 1px solid #1f1f1c; }
`;
// Fills a datetime field with the current local time and offset, e.g. 2026-11-18T09:30-08:00.
const NOW = `<script>function now(id){const d=new Date(),p=n=>String(Math.abs(n)).padStart(2,"0"),o=-d.getTimezoneOffset();document.getElementById(id).value=d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes())+(o<0?"-":"+")+p(o/60|0)+":"+p(o%60)}</script>`;

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const see = (location: string) => new Response(null, { status: 303, headers: { location } });
const label = (name: string) => name.replaceAll("_", " ");
const navFor = (tab?: Tab) => `<a href="/">snr intern</a>${tab ? `<a href="/${tab.slug}">${escape(tab.label)}</a>` : ""}<a class="external" href="https://admin.adhikrish.cloud/">admin</a>`;

function input(tab: Tab, f: Field, value: unknown): string {
  const id = `f-${f.name}`;
  const v = value === undefined || value === null ? "" : escape(value);
  const req = f.required ? " required" : "";
  let control: string;
  switch (f.type) {
    case "number": control = `<input id="${id}" name="${f.name}" type="number" step="any"${f.min !== undefined ? ` min="${f.min}"` : ""}${f.max !== undefined ? ` max="${f.max}"` : ""} value="${v}"${req}>`; break;
    case "lifts": control = `<textarea id="${id}" name="${f.name}" placeholder="flat db press: 45x10, 50x8; pull up: bwx10, +25x6"${req}>${v}</textarea>`; break;
    case "int": control = `<input id="${id}" name="${f.name}" type="number" step="1"${f.min !== undefined ? ` min="${f.min}"` : ""}${f.max !== undefined ? ` max="${f.max}"` : ""} value="${v}"${req}>`; break;
    case "date": control = `<input id="${id}" name="${f.name}" type="date" value="${v}"${req}>`; break;
    case "datetime": control = `<span class="row-input"><input id="${id}" name="${f.name}" placeholder="2026-11-18T09:30-08:00" value="${v}"${req}><button type="button" class="quiet" onclick="now('${id}')">now</button></span>`; break;
    case "url": control = `<input id="${id}" name="${f.name}" type="url" placeholder="https://" value="${v}"${req}>`; break;
    case "enum": control = `<select id="${id}" name="${f.name}"${req}><option value=""></option>${f.options!.map((o) => `<option${o === value ? " selected" : ""}>${escape(o)}</option>`).join("")}</select>`; break;
    default: {
      const long = f.name === tab.snippet || String(value ?? "").length > 80 || String(value ?? "").includes("\n");
      control = long ? `<textarea id="${id}" name="${f.name}"${req}>${v}</textarea>` : `<input id="${id}" name="${f.name}" value="${v}"${req}>`;
    }
  }
  const unit = f.unit ? ` (${escape(f.unit)})` : "";
  return `        <label for="${id}"><span>${label(f.name)}${unit}${f.required ? "<b>*</b>" : ""}</span>${control}</label>`;
}

function rowForm(design: Design, tab: Tab, values: Record<string, unknown>, opts: { action: string; title: string; error?: string; cancel: string }) {
  const body = `      <h1>${escape(opts.title)}</h1>
${opts.error ? `      <p class="error">${escape(opts.error)}</p>\n` : ""}      <form class="edit" method="post" action="${opts.action}">
${tab.fields.map((f) => input(tab, f, values[f.name])).join("\n")}
        <div class="actions"><button type="submit">save</button><a href="${opts.cancel}">cancel</a></div>
      </form>
      ${NOW}`;
  return page({ design, title: `${opts.title} | snr intern`, nav: navFor(tab), body, css: CSS });
}

const definitionOf = (tab: Tab) => { const { slug: _s, position: _p, ...d } = tab; return d; };

function schemaForm(design: Design, tab: Tab | null, text: string, opts: { slug?: string; error?: string; rows?: number }) {
  const isNew = !tab;
  const body = `      <h1>${isNew ? "new tab" : `${escape(tab.label)} schema`}</h1>
      <p class="hint">${isNew ? "a slug for the url, then the definition." : "the definition as json. fields can be added, removed or changed; existing rows keep their values."} field types: text, int (min, max, unit), date, datetime, url, enum (options). see API.md for every key.</p>
${opts.error ? `      <p class="error">${escape(opts.error)}</p>\n` : ""}      <form class="edit" method="post" action="${isNew ? "/_new" : `/${tab.slug}/_schema`}">
${isNew ? `        <label for="slug"><span>slug<b>*</b></span><input id="slug" name="slug" pattern="[a-z][a-z0-9-]*" value="${escape(opts.slug ?? "")}" placeholder="thoughts" required></label>\n` : ""}        <label for="definition"><span>definition</span><textarea id="definition" class="json" name="definition" spellcheck="false">${escape(text)}</textarea></label>
        <div class="actions"><button type="submit">save</button><a href="${isNew ? "/" : `/${tab.slug}`}">cancel</a></div>
      </form>
${!isNew ? `      <div class="danger-zone"><form method="post" action="/${tab.slug}/_schema/delete" onsubmit="return confirm('delete the ${escape(tab.label)} tab?')"><button class="danger" type="submit"${opts.rows ? " disabled" : ""}>delete tab</button></form><p class="hint">${opts.rows ? `delete its ${opts.rows} rows first.` : "only an empty tab can be deleted."}</p></div>` : ""}`;
  return page({ design, title: `${isNew ? "new tab" : `${tab.label} schema`} | snr intern`, nav: navFor(tab ?? undefined), body, css: CSS });
}

const NEW_TAB_TEMPLATE = JSON.stringify({ label: "", about: "", title: "name", aside: [], line: [], sort: "id", fields: [{ name: "name", type: "text", required: true }, { name: "notes", type: "text" }] }, null, 2);

/** Handles every form route. Returns null when the path isn't a form route. */
export async function handleForms(request: Request, database: D1Database, design: Design, who: string): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").slice(1); // ["_new"] | [tab, "_new"] | [tab, id, "_edit"] ...
  const isForm = parts.some((p) => p.startsWith("_"));
  if (!isForm) return null;
  if (request.method === "POST" && request.headers.get("origin") !== url.origin) return new Response("form posts must come from this site", { status: 403 });
  const form = request.method === "POST" ? await request.formData() : null;
  const fields = () => Object.fromEntries([...form!.entries()].map(([k, v]) => [k, String(v)]));

  if (parts.length === 1 && parts[0] === "_new") {
    if (!form) return html(schemaForm(design, null, NEW_TAB_TEMPLATE, {}));
    const slug = String(form.get("slug") ?? "").trim();
    const text = String(form.get("definition") ?? "");
    if (!SLUG.test(slug)) return html(schemaForm(design, null, text, { slug, error: "slug must be lowercase letters, digits and hyphens, starting with a letter" }), 400);
    if (await db.tab(database, slug)) return html(schemaForm(design, null, text, { slug, error: `a tab called "${slug}" already exists` }), 400);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return html(schemaForm(design, null, text, { slug, error: "definition is not valid json" }), 400); }
    const definition = checkDefinition(parsed);
    if (typeof definition === "string") return html(schemaForm(design, null, text, { slug, error: definition }), 400);
    await db.putTab(database, slug, definition, who);
    return see(`/${slug}`);
  }

  const tab = await db.tab(database, parts[0]);
  if (!tab) return html("not found", 404);

  if (parts[1] === "_schema") {
    if (parts[2] === "delete" && form) {
      return (await db.deleteTab(database, tab, who)) ? see("/") : html(schemaForm(design, tab, JSON.stringify(definitionOf(tab), null, 2), { error: "the tab still has rows", rows: await db.count(database, tab.slug) }), 409);
    }
    if (parts.length !== 2) return html("not found", 404);
    const rows = await db.count(database, tab.slug);
    if (!form) return html(schemaForm(design, tab, JSON.stringify(definitionOf(tab), null, 2), { rows }));
    const text = String(form.get("definition") ?? "");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return html(schemaForm(design, tab, text, { error: "definition is not valid json", rows }), 400); }
    const definition = checkDefinition(parsed);
    if (typeof definition === "string") return html(schemaForm(design, tab, text, { error: definition, rows }), 400);
    await db.putTab(database, tab.slug, definition, who);
    return see(`/${tab.slug}`);
  }

  if (parts.length === 2 && parts[1] === "_new") {
    const opts = { action: `/${tab.slug}/_new`, title: `add to ${tab.label}`, cancel: `/${tab.slug}` };
    if (!form) return html(rowForm(design, tab, {}, opts));
    const values = Object.fromEntries(Object.entries(fields()).filter(([, v]) => v.trim() !== ""));
    const change = checkRow(tab, values, { partial: false });
    if (typeof change === "string") return html(rowForm(design, tab, fields(), { ...opts, error: change }), 400);
    const row = await db.insert(database, tab.slug, change.set, who);
    return see(`/${tab.slug}/${row.id}`);
  }

  const id = Number(parts[1]);
  if (parts.length !== 3 || !Number.isInteger(id)) return html("not found", 404);
  const row = await db.get(database, tab.slug, id);
  if (!row) return html("not found", 404);

  if (parts[2] === "_edit") {
    const opts = { action: `/${tab.slug}/${id}/_edit`, title: `edit ${String(row[tab.title] ?? "row")}`, cancel: `/${tab.slug}/${id}` };
    if (!form) return html(rowForm(design, tab, row, opts));
    // an emptied field is cleared, so every field in the form is sent: empty -> null
    const values = Object.fromEntries(tab.fields.map((f) => [f.name, (form.get(f.name) ?? "").toString().trim() || null]));
    const change = checkRow(tab, values, { partial: true });
    if (typeof change === "string") return html(rowForm(design, tab, fields(), { ...opts, error: change }), 400);
    await db.update(database, tab.slug, id, change, who);
    return see(`/${tab.slug}/${id}`);
  }
  if (parts[2] === "_set" && form) {
    // one-click changes from a page (e.g. scoring a forecast): only the fields sent are changed
    const change = checkRow(tab, fields(), { partial: true });
    if (typeof change === "string") return html(`<p>${escape(change)}</p>`, 400);
    await db.update(database, tab.slug, id, change, who);
    const back = request.headers.get("referer");
    return see(back && new URL(back).origin === url.origin ? new URL(back).pathname : `/${tab.slug}`);
  }
  if (parts[2] === "_delete" && form) {
    await db.remove(database, tab.slug, id);
    return see(`/${tab.slug}`);
  }
  return html("not found", 404);
}
