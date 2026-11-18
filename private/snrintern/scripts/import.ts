// One-time import of the "snr intern" google sheet through snrintern's own api.
//   op run --env-file=<(echo ...) -- bun scripts/import.ts <tab> <file.csv|file.tsv>
// Each sheet row becomes POST /api/<tab>, so the server's validation applies.
// Auth comes from the environment: CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET (an access service token).
// SNRINTERN_URL overrides the target (default https://snrintern.adhikrish.cloud).
//
// The mapping below renames the sheet's columns and normalizes values (decided 2026-11-18):
// day-month-year dates become iso, "80%" becomes 80, TRUE becomes "right". A sheet column with data that
// has no mapping stops the import, so nothing is dropped silently; `drop` lists the columns that were empty.

type Transform = (value: string) => string | number | undefined;
type Mapping = { columns: Record<string, [field: string, transform?: Transform]>; drop: string[] };

/** "250626" -> "2026-06-25". The sheet wrote met_date as day, month, two-digit year. Anything else is dropped. */
const dayMonthYear: Transform = (v) => {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(v);
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : undefined;
};
/** "2026-07-07 17:25" -> "2026-07-07T17:25"; iso values pass through. */
const isoDateTime: Transform = (v) => v.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, "$1T$2");
const percent: Transform = (v) => Number(v.replace("%", "").trim());
const verdict: Transform = (v) => ({ TRUE: "right", FALSE: "wrong" } as Record<string, string>)[v.toUpperCase()] ?? v;
const lower: Transform = (v) => v.toLowerCase();

export const MAPPINGS: Record<string, Mapping> = {
  people: {
    columns: { name: ["name"], email: ["email"], company: ["company"], title: ["title"], met_where: ["met_where"], met_date: ["met_date", dayMonthYear],
      location: ["location"], linkedin: ["linkedin"], twitter: ["twitter"], referred_by: ["referred_by"], notes: ["notes"] },
    drop: ["added_date"],
  },
  outbound: {
    columns: { name: ["name"], "person context": ["context"], platform: ["platform"], reason: ["reason"], message: ["message"],
      replied: ["reply", lower], "follow-up #": ["follow_ups"], remarks: ["remarks"], email: ["email"] },
    drop: ["sent_date", "status", "last comment"],
  },
  forecasts: {
    columns: { date: ["date"], decision: ["decision"], rationale: ["rationale"], confidence: ["confidence", percent], expected: ["expected"],
      review_date: ["review_date"], outcome: ["outcome"], verdict: ["verdict", verdict], status: ["status", lower] },
    drop: [],
  },
  gym: {
    columns: { date: ["at", isoDateTime], type: ["type", lower], title: ["title"], summary: ["summary"], duration_min: ["duration_min"], rpe: ["rpe"], feel: ["notes"] },
    drop: [],
  },
};

/** RFC 4180 style: quoted fields may hold the delimiter, doubled quotes and newlines. Works for csv and tsv. */
export function parseTable(text: string, delimiter = text.split("\n")[0].includes("\t") ? "\t" : ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Sheet text -> api bodies for one tab, renamed and normalized. Throws on a column it doesn't know. */
export function sheetToRows(tab: string, text: string): Record<string, string | number>[] {
  const mapping = MAPPINGS[tab];
  if (!mapping) throw new Error(`no mapping for tab "${tab}". mapped: ${Object.keys(MAPPINGS).join(", ")}`);
  const [header, ...lines] = parseTable(text);
  const columns = header.map((h) => h.trim());
  const rows: Record<string, string | number>[] = [];
  for (const [n, line] of lines.entries()) {
    if (line.every((cell) => cell.trim() === "")) continue;
    const body: Record<string, string | number> = {};
    columns.forEach((column, i) => {
      const value = line[i]?.trim();
      if (!value) return;
      if (column === "" ) throw new Error(`${tab} row ${n + 2}: data in a column with no header: "${value.slice(0, 40)}"`);
      const target = mapping.columns[column];
      if (!target) {
        if (mapping.drop.includes(column)) throw new Error(`${tab} row ${n + 2}: "${column}" was supposed to be empty but holds "${value.slice(0, 40)}"`);
        throw new Error(`${tab}: sheet column "${column}" has no mapping`);
      }
      const [field, transform] = target;
      const out = transform ? transform(value) : value;
      if (out !== undefined && out !== "") body[field] = out;
    });
    rows.push(body);
  }
  return rows;
}

/** POSTs every row; stops at the first rejected row and says which one. */
export async function importRows(baseUrl: string, headers: Record<string, string>, tab: string, rows: Record<string, string | number>[]): Promise<number> {
  for (const [n, row] of rows.entries()) {
    const response = await fetch(`${baseUrl}/api/${tab}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(row) });
    if (response.status !== 201) throw new Error(`${tab} row ${n + 1}: ${response.status} ${await response.text()}`);
  }
  return rows.length;
}

if (import.meta.main) {
  const [tab, file] = process.argv.slice(2);
  const id = process.env.CF_ACCESS_CLIENT_ID, secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!tab || !file || !id || !secret) throw new Error("usage: CF_ACCESS_CLIENT_ID=.. CF_ACCESS_CLIENT_SECRET=.. bun scripts/import.ts <tab> <file>");
  const url = process.env.SNRINTERN_URL ?? "https://snrintern.adhikrish.cloud";
  const rows = sheetToRows(tab, await Bun.file(file).text());
  if (process.env.DRY_RUN) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  console.log(`imported ${await importRows(url, { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret }, tab, rows)} rows into ${tab}`);
}
