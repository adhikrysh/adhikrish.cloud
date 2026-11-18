// One-time import of the google sheet tabs, exported as csv, through snrintern's own api.
//   op run -- bun scripts/import.ts <tab> <file.csv>
// Sends each row as POST /api/<tab>, so the server's validation applies and updated_by records who imported.
// Auth comes from the environment: CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET (an access service token).
// SNRINTERN_URL overrides the target (default https://snrintern.adhikrish.cloud).
// Header names map to field names ("person context" -> person_context, "follow-up #" -> follow_up);
// columns with an empty header are dropped. Rows keep file order, so the last row gets the highest id.
/** RFC 4180 csv: quoted fields may hold commas, doubled quotes and newlines. */
export function parseCsv(text: string): string[][] {
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
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const fieldName = (header: string) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Turns csv text into api bodies: one object per non-empty row, keyed by field name. */
export function csvToRows(text: string): Record<string, string>[] {
  const [header, ...lines] = parseCsv(text);
  const names = header.map(fieldName);
  return lines
    .filter((line) => line.some((cell) => cell.trim() !== ""))
    .map((line) => {
      const body: Record<string, string> = {};
      names.forEach((name, i) => { if (name && line[i]?.trim()) body[name] = line[i].trim(); });
      return body;
    });
}

/** POSTs every row; stops at the first rejected row and says which one. */
export async function importCsv(baseUrl: string, headers: Record<string, string>, tab: string, text: string): Promise<number> {
  const rows = csvToRows(text);
  for (const [n, row] of rows.entries()) {
    const response = await fetch(`${baseUrl}/api/${tab}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(row) });
    if (response.status !== 201) throw new Error(`${tab} row ${n + 1}: ${response.status} ${await response.text()}`);
  }
  return rows.length;
}

if (import.meta.main) {
  const [tab, file] = process.argv.slice(2);
  const id = process.env.CF_ACCESS_CLIENT_ID, secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!tab || !file || !id || !secret) throw new Error("usage: CF_ACCESS_CLIENT_ID=.. CF_ACCESS_CLIENT_SECRET=.. bun scripts/import.ts <tab> <file.csv>");
  const url = process.env.SNRINTERN_URL ?? "https://snrintern.adhikrish.cloud";
  const n = await importCsv(url, { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret }, tab, await Bun.file(file).text());
  console.log(`imported ${n} rows into ${tab}`);
}
