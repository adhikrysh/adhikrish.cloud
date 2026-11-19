// End to end: d1 migrations applied by cf, the worker running in workerd (cloudflare's runtime), tabs defined
// from test/fixtures/tabs.json the way production is (PUT /api/_tabs), rows written through the api the way
// the agent writes them, and every page read back. A fake cloudflare access signs the jwts.
// Writes test/artifacts/e2e-report.json and the rendered pages.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const root = join(import.meta.dir, "..");
const artifacts = join(import.meta.dir, "artifacts");
const state = mkdtempSync(join(tmpdir(), "snrintern-d1-"));
const DB_ID = "7d86a3be-7d4b-45c6-97b1-d9990ae1d484";
const TEAM = "adhikrish";
const AUD = "e58f31f732ff5d00f7561ff36e3a9a23161176cdb806319370d50e6e2c0f387c"; // the real app's tag, as configured
const report: { scenario: string; status: number; detail?: unknown }[] = [];
mkdirSync(artifacts, { recursive: true }); // ignored by git, so a fresh checkout does not have it

let jwks: ReturnType<typeof Bun.serve>;
let worker: ReturnType<typeof Bun.spawn> | undefined;
let port = 0;
let sign: (claims: Record<string, unknown>, opts?: { aud?: string; forged?: boolean }) => Promise<string>;

/** A date `days` from today (negative = past), as yyyy-mm-dd. */
const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function startWorker() {
  port = 20000 + Math.floor(Math.random() * 20000);
  worker = Bun.spawn(["npx", "vite", "dev", "--mode", "test", "--port", String(port), "--strictPort"], {
    cwd: root,
    env: { ...process.env, SNRINTERN_STATE: state, ACCESS_CERTS_URL: `http://127.0.0.1:${jwks.port}/cdn-cgi/access/certs` },
    stdout: "pipe", stderr: "pipe",
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://localhost:${port}/`); return; } catch {} // any answer means the server is up
    await Bun.sleep(200);
  }
  throw new Error("worker did not start");
}

async function stopWorker() {
  worker?.kill();
  await worker?.exited;
}

async function call(scenario: string, path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("cf-access-jwt-assertion", init.token);
  const response = await fetch(`http://localhost:${port}${path}`, { ...init, headers, redirect: "manual" });
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await response.json() : await response.text();
  report.push({ scenario, status: response.status, detail: typeof body === "string" ? undefined : body });
  return { status: response.status, body: body as any };
}

const me = () => sign({ email: "me@example.com" });
const dots = () => sign({ common_name: "dots-client-id" });
const send = (token: string, path: string, body: unknown, method = "POST") =>
  call(`${method} ${path}`, path, { method, token, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const real = await generateKeyPair("RS256");
  const forger = await generateKeyPair("RS256");
  const publicJwk = { ...(await exportJWK(real.publicKey)), kid: "test-key", alg: "RS256" };
  jwks = Bun.serve({ port: 0, fetch: () => Response.json({ keys: [publicJwk] }) });
  sign = (claims, opts = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(`https://${TEAM}.cloudflareaccess.com`)
      .setAudience(opts.aud ?? AUD).setIssuedAt().setExpirationTime("10m").sign(opts.forged ? forger.privateKey : real.privateKey);

  const migrate = Bun.spawnSync(["npx", "cf", "d1", "migrations", "apply", DB_ID, "--local", "--persist-to", state], { cwd: root });
  if (migrate.exitCode !== 0) throw new Error(migrate.stdout.toString() + migrate.stderr.toString());
  await startWorker();

  // the schema, as production has it
  const token = await me();
  for (const [slug, definition] of Object.entries(await Bun.file(join(import.meta.dir, "fixtures", "tabs.json")).json())) {
    const r = await send(token, `/api/_tabs/${slug}`, definition, "PUT");
    if (r.status >= 300) throw new Error(`${slug}: ${JSON.stringify(r.body)}`);
  }
  for (const old of ["outbound", "gym"]) await call(`drop seed tab ${old}`, `/api/_tabs/${old}`, { method: "DELETE", token });

  // rows, written the way the agent writes them
  const rows: [string, Record<string, unknown>][] = [
    ["people", { name: "Ada Example", company: "Example Labs", title: "founder", met_where: "space week", group: "space & deep tech", last_contact: day(-120), linkedin: "https://www.linkedin.com/in/ada-example/", notes: "building small satellites" }],
    ["people", { name: "Ben Sample", company: "Sample VC", title: "partner", group: "investors & mentors", last_contact: day(-5), notes: "likes robots" }],
    ["people", { name: "Cy Placeholder", notes: "no group yet" }],
    ["forecasts", { date: day(-200), decision: "Due soon bet", confidence: 80, expected: "it happens", review_date: day(5), status: "open" }],
    ["forecasts", { date: day(-300), decision: "Overdue bet", confidence: 60, review_date: day(-10), status: "open" }],
    ["forecasts", { date: day(-100), decision: "Far away bet", confidence: 95, review_date: day(900), status: "open" }],
    ["forecasts", { date: day(-400), decision: "Scored bet", confidence: 80, review_date: day(-60), verdict: "right", status: "closed" }],
    ["training", { at: `${day(-20)}T18:00-08:00`, type: "strength", title: "chest", focus: "chest, arms", lifts: "flat db press: 45x10, 50x8; tricep pushdown: 50x8x3", duration_min: 60 }],
    ["training", { at: `${day(-13)}T18:00-08:00`, type: "strength", title: "chest", focus: "chest", lifts: "flat db press: 50x8, 60x6; pull up: bwx10" }],
    ["training", { at: `${day(-6)}T07:00-08:00`, type: "strength", title: "legs", focus: "legs", lifts: "leg press: 220x8, 260x10; pull up: +25x6" }],
    ["training", { at: day(-2), type: "run", title: "easy run", focus: "legs", distance_km: 5.2, duration_min: 30 }],
    ["body", { at: day(-30), bodyweight_kg: 68, bodyfat_percentage: 15.5 }],
    ["body", { at: day(-1), bodyweight_kg: 69.4 }],
  ];
  const importer = await sign({ email: "importer@example.com" });
  for (const [tab, row] of rows) {
    const r = await send(importer, `/api/${tab}`, row);
    if (r.status !== 201) throw new Error(`${tab}: ${JSON.stringify(r.body)}`);
  }
}, 120_000);

afterAll(async () => {
  await stopWorker();
  jwks.stop();
  writeFileSync(join(artifacts, "e2e-report.json"), JSON.stringify({ ranAt: new Date().toISOString(), calls: report }, null, 2));
  rmSync(state, { recursive: true, force: true });
});

test("the schema and rows are in place", async () => {
  const { body } = await call("list tabs", "/api", { token: await me() });
  expect(Object.fromEntries(body.tabs.map((t: any) => [t.slug, t.rows]))).toEqual({ people: 3, forecasts: 4, training: 4, body: 2 });
  expect(body.api.field_types.join(" ")).toContain("lifts");
});

test("requests that did not come through access are refused", async () => {
  expect((await call("no jwt", "/api")).status).toBe(401);
  expect((await call("jwt for another app", "/api", { token: await sign({ email: "me@example.com" }, { aud: "other-app" }) })).status).toBe(401);
  expect((await call("jwt signed by the wrong key", "/api", { token: await sign({ email: "me@example.com" }, { forged: true }) })).status).toBe(401);
  expect((await call("health from outside the uptime binding needs a jwt", "/health")).status).toBe(401);
  expect((await call("a service token that is not a listed agent may not read data", "/api", { token: await sign({ common_name: "some-other-token-id" }) })).status).toBe(403);
});

test("lifts are normalized on the way in, and malformed ones are refused with the reason", async () => {
  const token = await dots();
  const r = await send(token, "/api/training", { at: day(0), type: "strength", title: "back", lifts: "Seated Row: 100x8x2, 115 × 8; Pull Up: BW x 10, +25x6" });
  expect(r.status).toBe(201);
  expect(r.body.row.lifts).toBe("seated row: 100x8, 100x8, 115x8; pull up: bwx10, +25x6");
  expect(r.body.row.updated_by).toBe("service:dots-client-id");
  expect((await call("delete it", `/api/training/${r.body.row.id}`, { method: "DELETE", token })).status).toBe(200);
  const bad: [unknown, string][] = [
    [{ at: day(0), lifts: "bench 100x8" }, '"lifts" is not valid: "bench 100x8" needs "exercise: sets"'],
    [{ at: day(0), lifts: "bench: heavy" }, '"lifts" is not valid: "heavy" in bench must look like 50x8'],
    [{ at: day(0), distance_km: "far" }, '"distance_km" must be a number'],
    [{ at: day(0), type: "yoga" }, '"type" must be one of: strength, run, hike, climb, other'],
    [{ at: day(0), rpe: 11 }, '"rpe" must be at most 10'],
    [{ title: "no date" }, '"at" is required'],
  ];
  for (const [body, message] of bad) {
    const res = await send(token, "/api/training", body);
    expect(res.status).toBe(400);
    expect(res.body.error).toStartWith(message);
  }
  expect((await send(token, "/api/body", { at: day(0), bodyweight_kg: 400 })).body.error).toBe('"bodyweight_kg" must be at most 300');
});

test("the agent adds, edits, finds and deletes rows", async () => {
  const token = await dots();
  const added = await send(token, "/api/people", { name: "Dee Fixture", group: "hiring", notes: "recruiter at a rocket company" });
  const id = added.body.row.id;
  const edited = await send(token, `/api/people/${id}`, { last_contact: day(0), notes: null }, "PATCH");
  expect(edited.body.row).toMatchObject({ last_contact: day(0), group: "hiring" });
  expect(edited.body.row.notes).toBeUndefined();
  expect((await call("search values", "/api/people?q=robots", { token })).body.rows.map((r: any) => r.name)).toEqual(["Ben Sample"]);
  expect((await call("search ignores field names", "/api/people?q=last_contact", { token })).body.rows).toEqual([]);
  expect((await call("delete", `/api/people/${id}`, { method: "DELETE", token })).status).toBe(200);
  expect((await call("gone", `/api/people/${id}`, { token })).status).toBe(404);
});

test("the training page is built from the data: a strip of sessions, progress, bodyweight", async () => {
  const token = await me();
  const page = (await call("training page", "/training", { token })).body as string;
  // a tick per day from the first session (20 days ago) to today, green on the 4 days trained; no goals anywhere
  const strip = page.split('<div class="strip">')[1].split("</div>")[0];
  expect(strip.match(/<i /g)).toHaveLength(21);
  expect(strip.match(/class="up"/g)).toHaveLength(4);
  expect(page).toContain('<h2><span class="pill">sessions</span></h2><span>1.3 a week</span>');
  // the gap since the last session (2 days) is shorter than the longest before it (7): not red
  expect(page).toContain('<span class="">last session 2 days ago</span>');
  expect(page).not.toContain("this week");
  expect(page).not.toContain("last trained");
  // grouped by day: the heading is the date alone, and rows carry no time
  expect(page).not.toContain("6:00 pm");
  expect(page).not.toMatch(/<h2>[^<]*<small>/);
  // flat db press: 50 -> 60 over two sessions, latest is the best: green
  expect(page).toContain('flat db press</a><span class="sub"><span class="good">best 60 lb × 6</span>');
  // pull up tracked by added weight: bw x10 then +25x6
  expect(page).toContain('pull up</a><span class="sub"><span class="good">best +25 × 6</span>');
  // bodyweight line from the body tab: what happened, no target to compare against
  expect(page).toContain("69.4 kg");
  expect(page).toContain("<span>+1.4 kg since");
  expect(page).not.toContain(" to 75");
  expect(page).toContain('<h2><span class="pill">bodyfat</span></h2>'); // body is hidden, its trends live on training
  // a brand-new exercise shows up in progress after a second session, with no code change
  const dotsToken = await dots();
  await send(dotsToken, "/api/training", { at: `${day(-9)}T18:00-08:00`, type: "strength", title: "arms", lifts: "hammer curl: 30x10" });
  await send(dotsToken, "/api/training", { at: `${day(-1)}T18:00-08:00`, type: "strength", title: "arms", lifts: "hammer curl: 25x12" });
  const after = (await call("training page after new exercise", "/training", { token })).body as string;
  expect(after).toContain('hammer curl</a><span class="sub"><span class="bad">best 30 lb × 10</span><span>latest 25 lb × 12</span>');
  expect(after.split('<div class="strip">')[1].split("</div>")[0].match(/class="up"/g)).toHaveLength(6);
  expect(after).toContain("last session yesterday");
  expect(after).toContain('<nav aria-label="site"><a class="back" href="/" aria-label="back to senior intern">←</a><a class="external"'); // a tab goes back home
  writeFileSync(join(artifacts, "page-training.html"), after);
  // every lift opens its own page: each session plotted and listed, the best in green
  expect(after).toContain('<a class="name" href="/training/lifts/flat%20db%20press">flat db press</a>');
  const lift = (await call("lift page", "/training/lifts/flat%20db%20press", { token })).body as string;
  expect(lift.match(/<circle /g)).toHaveLength(2);
  expect(lift.match(/<text [^>]*text-anchor="(start|middle|end)">[a-z]{3} \d+<\/text>/g)).toHaveLength(2); // a date under every session
  // sessions at -60, -20, -16, -13 days: -16 sits too close to -20, so its date drops to a second line; every date still shows
  for (const [d, sets] of [[-60, "40x10"], [-16, "55x8"]] as const)
    await send(dotsToken, "/api/training", { at: `${day(d)}T18:00-08:00`, type: "strength", title: "chest", lifts: `flat db press: ${sets}` });
  const crowded = (await call("lift page with close sessions", "/training/lifts/flat%20db%20press", { token })).body as string;
  const labels = [...crowded.matchAll(/<text x="[\d.]+" y="(\d+)" text-anchor="(?:start|middle|end)">([a-z]{3} \d+)<\/text>/g)];
  expect(labels).toHaveLength(4);
  expect(new Set(labels.map((m) => m[1])).size).toBe(2);
  writeFileSync(join(artifacts, "page-lift-crowded.html"), crowded);
  expect(lift).toContain('best <span class="good">60 lb × 6</span>');
  expect(lift).toContain('<span class="sets"><span>50 lb × 8</span><span class="good">60 lb × 6</span></span>');
  expect((await call("unknown lift", "/training/lifts/nope", { token })).status).toBe(404);
  expect(lift).toContain('<a class="back" href="/training" aria-label="back to training">←</a>'); // a lift goes back to its tab
  writeFileSync(join(artifacts, "page-lift.html"), lift);
});

test("the contract is served by the api itself, as the agent sees it", async () => {
  const res = await call("docs", "/api/_docs", { token: await dots() });
  expect(res.status).toBe(200);
  const doc = res.body as string;
  expect(doc).toStartWith("# senior intern api");
  expect(doc).toContain("GET /api/_docs (same headers)");
  expect(doc).toBe(readFileSync(join(import.meta.dir, "../API.md"), "utf8")); // exactly the file in the repo
  expect((await call("api index", "/api", { token: await dots() })).body.api.docs).toStartWith("GET /api/_docs");
});

test("ten years of rows: pages of 50, search over all of them, the api and the charts see past 1000", async () => {
  const token = await me(), agent = await dots();
  const notes = { label: "notes", about: "paging test", title: "text", aside: [], line: [], sort: "at",
    views: [{ kind: "line", field: "n" }],
    fields: [{ name: "at", type: "date", required: true }, { name: "n", type: "int" }, { name: "text", type: "text" }] };
  expect((await send(agent, "/api/_tabs/notes", notes, "PUT")).status).toBe(201);
  const date = (n: number) => new Date(Date.UTC(2020, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
  const ns = Array.from({ length: 1005 }, (_, k) => k + 1);
  for (let k = 0; k < ns.length; k += 25)
    await Promise.all(ns.slice(k, k + 25).map((n) => send(agent, "/api/notes", { at: date(n), n, text: `note ${n} ${n % 2 ? "odd" : "even"}` })));
  const rowsOf = (html: string) => [...html.matchAll(/<span>(note \d+ \w+)<\/span>/g)].map((m) => m[1]);
  // page 1: the 50 newest, a link to older, none to newer; the chart counts from the very first row, not the 1000th newest
  const first = (await call("notes page 1", "/notes", { token })).body as string;
  expect(rowsOf(first)).toHaveLength(50);
  expect(rowsOf(first)[0]).toBe("note 1005 odd");
  expect(first).toContain('<a href="/notes?page=2">older →</a>');
  expect(first).not.toContain("← newer");
  expect(first).toContain("<span>+1004 since"); // 1005 - 1: every row, no cap
  // page 21 is past row 1000: the last 5, newer but no older, no views
  const last = (await call("notes page 21", "/notes?page=21", { token })).body as string;
  expect(rowsOf(last)).toEqual(["note 5 odd", "note 4 even", "note 3 odd", "note 2 even", "note 1 odd"]);
  expect(last).toContain('<a href="/notes?page=20">← newer</a>');
  expect(last).not.toContain("older →");
  expect(last).not.toContain('class="views"');
  expect((await call("notes page 22", "/notes?page=22", { token })).body).toContain("nothing older.");
  // search runs on the server over every row, and pages the same way, keeping the query
  const even = (await call("search even", "/notes?q=even", { token })).body as string;
  expect(rowsOf(even)).toHaveLength(50);
  expect(rowsOf(even).every((r) => r.endsWith("even"))).toBe(true);
  expect(even).toContain('<a href="/notes?q=even&amp;page=2">older →</a>');
  expect(rowsOf((await call("search even, page 11", "/notes?q=even&page=11", { token })).body as string)).toHaveLength(2); // 502 even: 10 pages of 50, then 2
  // the api walks any tab in pages, past 1000
  const a = (await call("api page 1", "/api/notes?limit=1000", { token: agent })).body;
  expect(a.rows).toHaveLength(1000);
  expect(a.next_offset).toBe(1000);
  const b = (await call("api page 2", "/api/notes?limit=1000&offset=1000", { token: agent })).body;
  expect(b.rows.map((r: any) => r.n)).toEqual([5, 4, 3, 2, 1]);
  expect(b.next_offset).toBe(null);
  writeFileSync(join(artifacts, "page-notes.html"), first);
  for (let k = 0; k < ns.length; k += 50) {
    const ids = (await call("notes ids", `/api/notes?limit=50`, { token: agent })).body.rows.map((r: any) => r.id);
    await Promise.all(ids.map((id: number) => call("delete note", `/api/notes/${id}`, { method: "DELETE", token: agent })));
  }
  expect((await call("drop notes", "/api/_tabs/notes", { method: "DELETE", token: agent })).status).toBe(200);
}, 120_000);

test("forecasts open on what is upcoming and how calibrated; scoring one (by the agent) moves it", async () => {
  const token = await me();
  const page = (await call("forecasts page", "/forecasts", { token })).body as string;
  // upcoming: the next 3 open ones, overdue first, however far away the rest are
  const upcoming = page.split('<h2><span class="pill">upcoming</span></h2>')[1].split("</section>")[0];
  expect(upcoming.indexOf("Overdue bet")).toBeLessThan(upcoming.indexOf("Due soon bet"));
  expect(upcoming.indexOf("Due soon bet")).toBeLessThan(upcoming.indexOf("Far away bet"));
  expect(upcoming).toContain('<small class="bad">overdue 10 days</small>');
  expect(upcoming).not.toContain("Scored bet");
  // calibration from the first scored one, as plain rows
  expect(page).toContain('<dl class="facts"><dt>avg confidence</dt><dd>80%</dd><dt>came true</dt><dd>1 of 1</dd></dl>');
  // rows: open a white pill, closed outlined, right green, wrong red; confidence and the review under the title, no description
  expect(page).toContain('<span class="pill">open</span>');
  expect(page).toContain('<span><span class="pill good">right</span></span><span><span class="pill outline">closed</span></span>');
  expect(page).toContain("<span>80%</span><span>review in 5 days</span>");
  expect(page).toContain('<span><span class="bad">review overdue by 10 days</span></span>'); // past and still open
  expect(page).toContain("<span>reviewed 2 months ago</span>"); // past and scored
  expect(page).not.toContain('class="snippet"'); // no description under rows; "expected" stays searchable and on the row page
  const overdue = (await call("forecast rows", "/api/forecasts?q=Overdue", { token })).body.rows[0];
  await send(await dots(), `/api/forecasts/${overdue.id}`, { verdict: "wrong", status: "closed" }, "PATCH");
  const after = (await call("forecasts page after scoring", "/forecasts", { token })).body as string;
  expect(after.split('<h2><span class="pill">upcoming</span></h2>')[1].split("</section>")[0]).not.toContain("Overdue bet");
  expect(after).toContain("<span>reviewed 10 days ago</span>");
  expect(after).toContain("<dt>avg confidence</dt><dd>70%</dd><dt>came true</dt><dd>1 of 2</dd>");
  expect(after).toContain('<span class="pill bad">wrong</span>');
  writeFileSync(join(artifacts, "page-forecasts.html"), after);
});

test("people are a search and their groups, nothing above", async () => {
  const token = await me();
  const page = (await call("people page", "/people", { token })).body as string;
  expect(page).not.toContain('<div class="views">');
  const list = page.split('<div class="rows">')[1];
  expect(list).toContain('<details class="group">');
  expect(list).toContain("<summary>space &amp; deep tech</summary>");
  expect(list).toContain("<summary>no group</summary>");
  // a topic nobody defined anywhere: the agent just writes it, and it becomes a group
  await send(await dots(), "/api/people", { name: "Eve New", group: "climate" });
  expect((await call("people page after new topic", "/people", { token })).body).toContain("<summary>climate</summary>");
  writeFileSync(join(artifacts, "page-people.html"), page);
});

test("home is just the visible tabs, no numbers", async () => {
  const page = (await call("home", "/", { token: await me() })).body as string;
  for (const tab of ["people", "forecasts", "training"]) expect(page).toContain(`href="/${tab}"`);
  expect(page).not.toContain('href="/body"'); // hidden
  expect(page).not.toContain("<small>");
  expect(page).not.toContain('class="views"');
  expect(page).toContain('<nav aria-label="site"><a class="external" href="https://uptime.adhikrish.cloud/">uptime</a></nav>'); // only uptime, top right
  writeFileSync(join(artifacts, "page-home.html"), page);
});

test("tabs and columns are added through the api, with no migration, and every change is logged", async () => {
  const token = await dots();
  const body = (await call("body schema", "/api/_tabs/body", { token })).body.tab;
  const { slug: _s, position: _p, ...definition } = body;
  expect((await send(token, "/api/_tabs/body", { ...definition, fields: [...definition.fields, { name: "waist_cm", type: "number", unit: "cm" }] }, "PUT")).status).toBe(200);
  expect((await send(token, "/api/body", { at: day(0), waist_cm: 78.5 })).body.row.waist_cm).toBe(78.5);
  const thoughts = { label: "thoughts", about: "things worth remembering", title: "text", sort: "at", fields: [{ name: "text", type: "text", required: true }, { name: "at", type: "datetime" }] };
  expect((await send(token, "/api/_tabs/thoughts", thoughts, "PUT")).status).toBe(201);
  expect((await send(token, "/api/thoughts", { text: "the schema is data", at: day(0) })).status).toBe(201);
  expect((await call("delete tab with rows", "/api/_tabs/thoughts", { method: "DELETE", token })).status).toBe(409);
  const bad: [unknown, string][] = [
    [{ ...thoughts, fields: [{ name: "id", type: "text" }] }, 'field name "id" is reserved'],
    [{ ...thoughts, fields: [{ name: "mood", type: "enum" }] }, 'field "mood": enum fields need "options"'],
    [{ ...thoughts, views: [{ kind: "progress", field: "text" }] }, 'views[0] (progress): "field" must name a lifts field'],
    [{ ...thoughts, views: [{ kind: "line", field: "nope" }] }, 'views[0] (line): "field" must name a number field'],
    [{ ...thoughts, views: [{ kind: "weekly" }] }, "views[0]: kind must be one of progress, strip, line, upcoming, calibration"],
  ];
  for (const [d, message] of bad) expect((await send(token, "/api/_tabs/scratch", d, "PUT")).body.error).toStartWith(message);
  const log = (await call("schema log", "/api/_log", { token })).body.changes;
  expect(log.slice(0, 2).map((c: any) => [c.tab, c.before === null ? "created" : "changed", c.by])).toEqual([
    ["thoughts", "created", "service:dots-client-id"], ["body", "changed", "service:dots-client-id"],
  ]);
});

test("the pages are read-only: no forms, no write routes", async () => {
  const token = await me();
  for (const path of ["/", "/training", "/people", "/forecasts"]) {
    const page = (await call(`page ${path}`, path, { token })).body as string;
    expect(page).not.toContain("<form method=\"post\"");
    expect(page).not.toContain("_edit");
  }
  for (const path of ["/training/_new", "/training/1/_edit", "/training/_schema", "/_new"]) {
    expect((await call(`no form at ${path}`, path, { token })).status).toBe(404);
    expect((await call(`no post at ${path}`, path, { method: "POST", token, headers: { origin: `http://localhost:${port}` }, body: "x=1" })).status).toBe(405);
  }
});

test("every page and a row render; a row shows its lifts per exercise", async () => {
  const token = await me();
  for (const tab of ["people", "forecasts", "training", "body"]) {
    const { status, body } = await call(`page ${tab}`, `/${tab}`, { token });
    expect(status).toBe(200);
    expect(body).not.toContain("#d9a441"); // greys, green and red only
    writeFileSync(join(artifacts, `page-${tab}.html`), body);
  }
  const chest = (await call("chest", "/api/training?q=tricep", { token })).body.rows[0];
  const row = (await call("row page", `/training/${chest.id}`, { token })).body as string;
  expect(row).toContain('<span class="ex">tricep pushdown</span>50 × 8   50 × 8   50 × 8');
  expect(row).toContain(`<a class="schema" href="/api/_tabs/training">schema</a>`);
  expect(row).toContain('<a class="back" href="/training" aria-label="back to training">←</a>'); // a row goes back to its tab
  expect(row).not.toContain('<a href="/people">'); // no sibling tabs in the nav
  writeFileSync(join(artifacts, "page-training-row.html"), row);
});

test("a restart loses nothing", { timeout: 60_000 }, async () => {
  const token = await me();
  await send(token, "/api/forecasts", { decision: "Restart keeps data", confidence: 99 });
  await stopWorker();
  await startWorker();
  const after = await call("read after restart", "/api/forecasts?q=Restart", { token });
  expect(after.body.rows).toHaveLength(1);
  expect((await call("schema survives too", "/api/_tabs/thoughts", { token })).status).toBe(200);
});
