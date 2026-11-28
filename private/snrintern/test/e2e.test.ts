// End to end: d1 migrations applied by cf, the worker running in workerd (cloudflare's runtime), tabs defined
// from test/fixtures/tabs.json the way production is (PUT /api/_tabs), rows written through the api the way
// the agent writes them, and every page read back. A fake cloudflare access signs the jwts.
// Writes test/artifacts/e2e-report.json and the rendered pages.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { HISTORY, NOT_WORN, numbers, startFakeGarmin } from "./fake-garmin.ts";

const root = join(import.meta.dir, "..");
const artifacts = join(import.meta.dir, "artifacts");
const state = mkdtempSync(join(tmpdir(), "snrintern-d1-"));
const DB_ID = "7d86a3be-7d4b-45c6-97b1-d9990ae1d484";
const TEAM = "adhikrish";
const AUD = "e58f31f732ff5d00f7561ff36e3a9a23161176cdb806319370d50e6e2c0f387c"; // the real app's tag, as configured
const report: { scenario: string; status: number; detail?: unknown }[] = [];
/** The charts a page embeds: each one's data as the drawing script receives it. */
const charts = (html: string) => [...html.matchAll(/data-chart="([^"]*)"/g)].map((m) => JSON.parse(m[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&#39;", "'")));
/** A page that opens from disk: the chart and graph libraries inlined instead of fetched from the worker, so the artifact draws. */
const CHART_LIB = readFileSync(join(import.meta.dir, "../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js"), "utf8");
const GRAPH_LIB = ["cytoscape/dist/cytoscape.min.js", "layout-base/layout-base.js", "cose-base/cose-base.js", "cytoscape-fcose/cytoscape-fcose.js"]
  .map((p) => readFileSync(join(import.meta.dir, "../node_modules", p), "utf8")).join(";\n");
const standalone = (html: string) => html.replace(/<script src="\/_charts-[\d.]+\.js"><\/script>/, () => `<script>${CHART_LIB}</script>`)
  .replace(/<script src="\/_graph-[\w.-]+\.js"><\/script>/, () => `<script>${GRAPH_LIB}</script>`);
mkdirSync(artifacts, { recursive: true }); // ignored by git, so a fresh checkout does not have it

let jwks: ReturnType<typeof Bun.serve>;
const garmin = startFakeGarmin();
let worker: ReturnType<typeof Bun.spawn> | undefined;
let port = 0;
let sign: (claims: Record<string, unknown>, opts?: { aud?: string; forged?: boolean }) => Promise<string>;

// the made-up birthday the worker gets in test mode (cloudflare.config.ts), and the live labels it should give, worked out here
// on their own from the agreed formulas: 4,000 weeks minus weeks lived; felt time left = 1 - ln(age/7) / ln(end/7)
const BIRTHDAY = "1990-01-01";
// days are counted where you are: the offset on the newest training row (src/here.ts), so ask the api for it the way an agent would
let here = 0;
const findHere = async () => {
  const at = String((await call("where am i", "/api/training?limit=1", { token: await me() })).body.rows[0].at), m = /([+-])(\d{2}):(\d{2})$/.exec(at)!;
  here = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
};
const todayHere = () => { const d = new Date(Date.now() + here * 60_000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const lived = () => Math.round((todayHere() - Date.UTC(1990, 0, 1)) / 86_400_000);
const weeksLeft = () => `${((28_000 - lived()) / 7).toFixed(2)} weeks`;
const feltLeft = () => `${((1 - Math.log(lived() / 365.25 / 7) / Math.log(28_000 / 365.25 / 7)) * 100).toFixed(2)}% of perceptive time`;

/** A date `days` from today (negative = past), as yyyy-mm-dd. */
const day = (days: number) => new Date(Date.now() - 8 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10); // pacific, like every timed seed (-08:00)

async function startWorker() {
  port = 20000 + Math.floor(Math.random() * 20000);
  worker = Bun.spawn(["npx", "vite", "dev", "--mode", "test", "--port", String(port), "--strictPort"], {
    cwd: root,
    env: { ...process.env, SNRINTERN_STATE: state, ACCESS_CERTS_URL: `http://127.0.0.1:${jwks.port}/cdn-cgi/access/certs`, GARMIN_URL: garmin.url },
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
const instinct = () => sign({ common_name: "instinct-client-id" }); // a second agent, with its own token
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
  const fixtures = await Bun.file(join(import.meta.dir, "fixtures", "tabs.json")).json();
  for (const [slug, definition] of Object.entries(fixtures)) {
    const r = await send(token, `/api/_tabs/${slug}`, definition, "PUT");
    if (r.status >= 300) throw new Error(`${slug}: ${JSON.stringify(r.body)}`);
  }
  // home's order, set the way production's was: each tab right after the one before it
  const home = ["obsessions", "training", "health", "people", "predictions", "reccos"];
  for (let i = 1; i < home.length; i++) await send(token, `/api/_tabs/${home[i]}`, { ...(fixtures as any)[home[i]], after: home[i - 1] }, "PUT");
  for (const old of ["outbound", "gym", "forecasts"]) await call(`drop seed tab ${old}`, `/api/_tabs/${old}`, { method: "DELETE", token });

  // rows, written the way the agent writes them
  const rows: [string, Record<string, unknown>][] = [
    ["people", { name: "Ada Example", company: "Example Labs", title: "founder", met_where: "space week", group: "space & deep tech", last_contact: day(-120), linkedin: "https://www.linkedin.com/in/ada-example/", notes: "building small satellites" }],
    ["people", { name: "Ben Sample", company: "Sample VC", title: "partner", group: "investors & mentors", last_contact: day(-5), notes: "likes robots" }],
    ["people", { name: "Cy Placeholder", notes: "no group yet" }],
    ["predictions", { date: day(-200), decision: "Due soon bet", confidence: 80, expected: "it happens", review_date: day(5), status: "open" }],
    ["predictions", { date: day(-300), decision: "Overdue bet", confidence: 60, review_date: day(-10), status: "open" }],
    ["predictions", { date: day(-100), decision: "Far away bet", confidence: 95, review_date: day(900), status: "open" }],
    ["predictions", { date: day(-400), decision: "Scored bet", confidence: 80, review_date: day(-60), verdict: "right", status: "closed" }],
    ["training", { at: `${day(-20)}T18:00-08:00`, type: "strength", title: "chest", focus: "chest, arms", lifts: "flat db press: 45x10, 50x8; tricep pushdown: 50x8x3", duration_min: 60 }],
    ["training", { at: `${day(-13)}T18:00-08:00`, type: "strength", title: "chest", focus: "chest", lifts: "flat db press: 50x8, 60x6; pull up: bwx10" }],
    ["training", { at: `${day(-6)}T07:00-08:00`, type: "strength", title: "legs", focus: "legs", lifts: "leg press: 220x8, 260x10; pull up: +25x6" }],
    ["training", { at: `${day(-2)}T07:00-08:00`, type: "run", title: "easy run", focus: "legs", distance_km: 5.2, duration_min: 30 }],
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
  garmin.server.stop();
  writeFileSync(join(artifacts, "e2e-report.json"), JSON.stringify({ ranAt: new Date().toISOString(), calls: report }, null, 2));
  rmSync(state, { recursive: true, force: true });
});

test("the schema and rows are in place", async () => {
  const { body } = await call("list tabs", "/api", { token: await me() });
  expect(Object.fromEntries(body.tabs.map((t: any) => [t.slug, t.rows]))).toEqual({ people: 3, companies: 2, events: 1, predictions: 4, training: 4, body: 2, reccos: 0, health: 0, obsessions: 0, notes: 0 });
  expect(body.api.field_types.join(" ")).toContain("lifts");
});

test("requests that did not come through access are refused", async () => {
  expect((await call("no jwt", "/api")).status).toBe(401);
  expect((await call("jwt for another app", "/api", { token: await sign({ email: "me@example.com" }, { aud: "other-app" }) })).status).toBe(401);
  expect((await call("jwt signed by the wrong key", "/api", { token: await sign({ email: "me@example.com" }, { forged: true }) })).status).toBe(401);
  const health = await call("health needs no jwt (access guards it in production)", "/_health");
  expect(health.status).toBe(200);
  expect(health.body).toMatchObject({ ok: true }); expect(typeof health.body.ms).toBe("number"); // and it reports its own query time and where it ran
  expect((await call("a service token that is not a listed agent may not read data", "/api", { token: await sign({ common_name: "some-other-token-id" }) })).status).toBe(403);
});

test("lifts are normalized on the way in, and malformed ones are refused with the reason", async () => {
  const token = await dots();
  const r = await send(token, "/api/training", { at: `${day(0)}T09:00-08:00`, type: "strength", title: "back", lifts: "Seated Row: 100x8x2, 115 × 8; Pull Up: BW x 10, +25x6" });
  expect(r.status).toBe(201);
  expect(r.body.row.lifts).toBe("seated row: 100x8, 100x8, 115x8; pull up: bwx10, +25x6");
  expect(r.body.row.updated_by).toBe("service:dots-client-id");
  expect((await call("delete it", `/api/training/${r.body.row.id}`, { method: "DELETE", token })).status).toBe(200);
  const bad: [unknown, string][] = [
    [{ at: `${day(0)}T09:00-08:00`, lifts: "bench 100x8" }, '"lifts" is not valid: "bench 100x8" needs "exercise: sets"'],
    [{ at: `${day(0)}T09:00-08:00`, lifts: "bench: heavy" }, '"lifts" is not valid: "heavy" in bench must look like 50x8'],
    [{ at: `${day(0)}T09:00-08:00`, distance_km: "far" }, '"distance_km" must be a number'],
    [{ at: `${day(0)}T09:00-08:00`, type: "yoga" }, '"type" must be one of: strength, run, hike, climb, swim, ride, sport, other'],
    [{ at: `${day(0)}T09:00-08:00`, rpe: 11 }, '"rpe" must be at most 10'],
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
  // a second agent writes the same way, and the row says which agent wrote it
  const other = await send(await instinct(), "/api/people", { name: "Fay Second Agent" });
  expect(other.status).toBe(201);
  expect(other.body.row.updated_by).toBe("service:instinct-client-id");
  expect((await call("second agent deletes", `/api/people/${other.body.row.id}`, { method: "DELETE", token: await instinct() })).status).toBe(200);
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
  expect(charts(after).some((c) => c.base === "/body/")).toBe(true); // bodyweight: every weigh-in, each dot opening its day
  // each exercise in progress: a box of dots on the right, one per session, the latest white
  const press = after.split('flat db press</a>')[1].split('</div>')[0];
  expect(press.match(/<circle /g)).toHaveLength(2);
  expect(press).toContain('<circle class="today"');
  expect(press).toContain("<polyline ");
  writeFileSync(join(artifacts, "page-training.html"), standalone(after));
  // every lift opens its own page: each session plotted and listed, the best in green
  expect(after).toContain('<a class="name" href="/training/lifts/flat%20db%20press">flat db press</a>');
  const lift = (await call("lift page", "/training/lifts/flat%20db%20press", { token })).body as string;
  // a zoomable chart: one dot per session day, each opening its session; the best one marked
  const liftChart = charts(lift)[0];
  expect(liftChart.points).toHaveLength(2);
  expect(liftChart.points.map((p: unknown[]) => p[1])).toEqual([50, 60]);
  expect(liftChart.base).toBe("/training/");
  expect(liftChart.best).toEqual([liftChart.points[1][0], liftChart.points[1][0]]);
  expect(lift).toContain('<script src="/_charts-5.2.1.js"></script>');
  // sessions at -60, -20, -16, -13 days: -16 sits too close to -20, so its date drops to a second line; every date still shows
  for (const [d, sets] of [[-60, "40x10"], [-16, "55x8"]] as const)
    await send(dotsToken, "/api/training", { at: `${day(d)}T18:00-08:00`, type: "strength", title: "chest", lifts: `flat db press: ${sets}` });
  const crowded = (await call("lift page with close sessions", "/training/lifts/flat%20db%20press", { token })).body as string;
  expect(charts(crowded)[0].points).toHaveLength(4); // close sessions are still one dot each; the chart zooms instead of crowding labels
  writeFileSync(join(artifacts, "page-lift-crowded.html"), standalone(crowded));
  expect(lift).toContain('best <span class="good">60 lb × 6</span>');
  expect(lift).toContain('<span class="sets"><span>50 lb × 8</span><span class="good">60 lb × 6</span></span>');
  expect((await call("unknown lift", "/training/lifts/nope", { token })).status).toBe(404);
  expect(lift).toContain('<a class="back" href="/training" aria-label="back to training">←</a>'); // titles never change // a lift goes back to its tab
  writeFileSync(join(artifacts, "page-lift.html"), standalone(lift));
  // the library is served by the worker itself, cached forever
  const lib = await fetch(`http://localhost:${port}/_charts-5.2.1.js`, { headers: { "cf-access-jwt-assertion": token } });
  expect(lib.status).toBe(200);
  expect(lib.headers.get("cache-control")).toContain("immutable");
  expect(await lib.text()).toContain("LightweightCharts");
});

test("the contract is served by the api itself, split so an agent reads only what it needs", async () => {
  const agent = await dots();
  const file = (name: string) => readFileSync(join(import.meta.dir, "../docs", `${name}.md`), "utf8");
  // the core, then a page per tab and one for the schema, each exactly the file in the repo
  const core = await call("docs core", "/api/_docs", { token: agent });
  expect(core.status).toBe(200);
  expect(core.body).toBe(file("core"));
  for (const name of ["training", "health", "people", "predictions", "reccos", "obsessions", "notes", "schema"])
    expect((await call(`docs ${name}`, `/api/_docs/${name}`, { token: agent })).body).toBe(file(name));
  // every visible tab has its rules; a missing page lists the real ones
  const tabs = (await call("api index", "/api", { token: agent })).body;
  for (const t of tabs.tabs.filter((t: any) => !t.hidden)) expect((await call(`docs for ${t.slug}`, `/api/_docs/${t.slug}`, { token: agent })).status).toBe(200);
  const missing = await call("docs missing", "/api/_docs/nope", { token: agent });
  expect(missing.status).toBe(404);
  expect(missing.body.error).toBe("no such page; there are: health, notes, obsessions, people, predictions, reccos, schema, training");
  expect(tabs.api.agents).toStartWith("GET /api/_agents");
  // core.md names exactly the visible tabs, each with its own page, so the agent's instructions never miss one or name a gone one
  const fixtures = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/tabs.json"), "utf8"));
  const visible = Object.keys(fixtures).filter((slug) => !fixtures[slug].hidden).sort();
  const named = /live at https:\/\/seniorintern\.adhikrish\.cloud: ([a-z, -]+)\./.exec(file("core"))![1].split(", ").sort();
  expect(named).toEqual(visible);
  for (const slug of visible) expect(readdirSync(join(import.meta.dir, "../docs"))).toContain(`${slug}.md`);
  // small enough to read every conversation: the core stays under 600 words
  expect(file("core").split(/\s+/).length).toBeLessThan(600);
});

test("skills are served by the api and named in the agent's instructions, so it finds them before it needs them", async () => {
  const agent = await dots();
  const file = readFileSync(join(import.meta.dir, "../skills/fitness-coach.md"), "utf8");
  const list = (await call("skills", "/api/_skills", { token: agent })).body.skills;
  expect(list).toEqual([{ name: "fitness-coach", read: "GET /api/_skills/fitness-coach" }]);
  // every skill file is named in core.md, which every agent reads, so none is ever unfindable
  const core = readFileSync(join(import.meta.dir, "../docs/core.md"), "utf8");
  for (const f of readdirSync(join(import.meta.dir, "../skills"))) expect(core).toContain(`- **${f.replace(/\.md$/, "")}**: `);
  expect((await call("fitness coach skill", "/api/_skills/fitness-coach", { token: agent })).body).toBe(file);
  // the skill reads what senior intern computes, and the pages that point to it are served too
  for (const path of ["/api/health/_views", "/api/training/_views", "/api/training", "/api/obsessions"]) expect(file).toContain(path);
  expect((await call("training rules", "/api/_docs/training", { token: agent })).body).toContain("GET /api/_skills/fitness-coach");
  expect((await call("api lists skills", "/api", { token: agent })).body.skills).toEqual(["fitness-coach"]);
  const missing = await call("no such skill", "/api/_skills/nope", { token: agent });
  expect(missing.status).toBe(404);
  expect(missing.body.error).toBe("no such skill; there are: fitness-coach");
  expect((await call("skills are read-only", "/api/_skills/fitness-coach", { method: "PUT", token: await me(), body: "x" })).status).toBe(405);
});

test("a coach keeps its memory as notes; each coach gets a link above senior intern and a page of its thoughts, newest first", async () => {
  const token = await me(), agent = await dots();
  expect((await call("home before any notes", "/", { token })).body).not.toContain('class="coaches"');
  const note = (at: string, coach: string, text: string) => send(agent, "/api/notes", { at, coach, note: text });
  await note("2026-11-20T07:05-08:00", "fitness coach", "access: gym and pool, no bike.");
  await note("2026-11-27T18:42-08:00", "fitness coach", "shins sore after the long run. holding run volume, more calf and tibialis work.\nrecheck in a week.");
  await note("2026-11-26T09:00-08:00", "daily coach", "this week's constraint: sleep.");
  expect((await note("2026-11-27", "fitness coach", "no time")).body.error).toContain("time"); // a note says when, to the minute
  expect((await send(agent, "/api/notes", { at: "2026-11-27T10:00-08:00", note: "who wrote this?" })).body.error).toStartWith('"coach" is required');
  // home: one underlined link per coach, above the title, apart from the tabs
  const home = (await call("home with coaches", "/", { token })).body as string;
  expect(home).toContain('<p class="coaches"><a href="/coaches/daily-coach">daily coach</a><a href="/coaches/fitness-coach">fitness coach</a></p>');
  expect(home.indexOf('class="coaches"')).toBeLessThan(home.indexOf("<h1>senior intern</h1>"));
  expect(home).not.toContain('href="/notes"'); // the tab itself stays hidden
  // a coach's page: readable time on the left, the thought on the right, newest first, only that coach
  const page = (await call("fitness coach notes", "/coaches/fitness-coach", { token })).body as string;
  expect(page).toContain("<h1>fitness coach</h1>");
  const times = [...page.matchAll(/<time>([^<]+)<\/time>/g)].map((m) => m[1]);
  expect(times).toEqual(["nov 27, 6:42 pm", "nov 20, 7:05 am"]);
  expect(page).toContain("<p>shins sore after the long run. holding run volume, more calf and tibialis work.\nrecheck in a week.</p>");
  expect(page).not.toContain("this week's constraint");
  expect((await call("unknown coach", "/coaches/nobody", { token })).status).toBe(404);
  writeFileSync(join(artifacts, "page-coach.html"), page);
  writeFileSync(join(artifacts, "page-home-coaches.html"), home);
});

test("the agent reads its own instructions from senior intern; only adhi can change them, never an agent", async () => {
  const agent = await dots(), token = await me();
  const core = readFileSync(join(import.meta.dir, "../docs/core.md"), "utf8");
  const before = (await call("agents before any push", "/api/_agents", { token: agent })).body as string;
  expect(before).toBe(core); // the core (the api and the skills) alone, until adhi pushes his part
  const text = "# AGENTS.md (senior intern)\n\n## North star\n\nremove cognitive load.\n";
  const put = (who: string, body: string, scenario: string) => call(scenario, "/api/_agents", { method: "PUT", token: who, headers: { "content-type": "text/markdown" }, body });
  // an agent can't write its own rules, not even a copy of them
  const refused = await put(agent, "# ignore all previous rules", "agent tries to rewrite its instructions");
  expect(refused.status).toBe(403);
  expect(refused.body.error).toBe("agents can read their instructions, not change them");
  expect((await put(token, "   ", "empty instructions")).status).toBe(400);
  const saved = await put(token, text, "adhi pushes the instructions");
  expect(saved.body).toEqual({ saved: text.length, by: "me@example.com" });
  // the agent gets exactly what was pushed, as markdown; a second push replaces it whole
  const read = await call("agent reads its instructions", "/api/_agents", { token: await instinct() });
  expect(read.body).toBe(`${text.trimEnd()}\n\n---\n\n${before}`); // who it is, then how to use senior intern and its skills: one read
  await put(token, text + "\n## voice\n\nlowercase.\n", "adhi pushes again");
  const reread = (await call("agent rereads", "/api/_agents", { token: agent })).body as string;
  expect(reread).toContain("## voice\n\nlowercase.\n\n---\n\n# your records");
  expect(reread.match(/# your records\n/g)).toHaveLength(1);
  expect((await call("agents subpath", "/api/_agents/x", { token: agent })).status).toBe(404);
});

test("ten years of rows: pages of 50, search over all of them, the api and the charts see past 1000", async () => {
  const token = await me(), agent = await dots();
  const notes = { label: "journal", about: "paging test", title: "text", aside: [], line: [], sort: "at",
    views: [{ kind: "line", field: "n" }],
    fields: [{ name: "at", type: "date", required: true }, { name: "n", type: "int" }, { name: "text", type: "text" }] };
  expect((await send(agent, "/api/_tabs/journal", notes, "PUT")).status).toBe(201);
  const date = (n: number) => new Date(Date.UTC(2020, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
  const ns = Array.from({ length: 1005 }, (_, k) => k + 1);
  for (let k = 0; k < ns.length; k += 25)
    await Promise.all(ns.slice(k, k + 25).map((n) => send(agent, "/api/journal", { at: date(n), n, text: `note ${n} ${n % 2 ? "odd" : "even"}` })));
  const rowsOf = (html: string) => [...html.matchAll(/<span>(note \d+ \w+)<\/span>/g)].map((m) => m[1]);
  // page 1: the 50 newest, a link to older, none to newer; the chart counts from the very first row, not the 1000th newest
  const first = (await call("notes page 1", "/journal", { token })).body as string;
  expect(rowsOf(first)).toHaveLength(50);
  expect(rowsOf(first)[0]).toBe("note 1005 odd");
  // the pages as numbers: 1 (here), 2, 3, …, 21
  expect(first).toContain('<nav class="pager" aria-label="pages"><span class="at" aria-current="page">1</span><a href="/journal?page=2">2</a><a href="/journal?page=3">3</a><span class="gap">…</span><a href="/journal?page=21">21</a></nav>');
  expect(first).toContain("<span>+1004 since"); // 1005 - 1: every row, no cap
  // page 21 is past row 1000: the last 5, newer but no older, no views
  const last = (await call("notes page 21", "/journal?page=21", { token })).body as string;
  expect(rowsOf(last)).toEqual(["note 5 odd", "note 4 even", "note 3 odd", "note 2 even", "note 1 odd"]);
  expect(last).toContain('<a href="/journal">1</a><a href="/journal?page=2">2</a><a href="/journal?page=3">3</a><span class="gap">…</span><a href="/journal?page=20">20</a><span class="at" aria-current="page">21</span></nav>');
  const middle = (await call("notes page 10", "/journal?page=10", { token })).body as string;
  expect(middle).toContain('<a href="/journal?page=3">3</a><span class="gap">…</span><a href="/journal?page=9">9</a><span class="at" aria-current="page">10</span><a href="/journal?page=11">11</a><span class="gap">…</span><a href="/journal?page=21">21</a></nav>');
  expect(last).not.toContain('class="views"');
  expect((await call("notes page 22", "/journal?page=22", { token })).body).toContain("nothing older.");
  // search runs on the server over every row, and pages the same way, keeping the query
  const even = (await call("search even", "/journal?q=even", { token })).body as string;
  expect(rowsOf(even)).toHaveLength(50);
  expect(rowsOf(even).every((r) => r.endsWith("even"))).toBe(true);
  expect(even).toContain('<a href="/journal?q=even&amp;page=2">2</a>');
  expect(even).toContain('<a href="/journal?q=even&amp;page=11">11</a></nav>'); // 502 even rows: 11 pages
  expect(rowsOf((await call("search even, page 11", "/journal?q=even&page=11", { token })).body as string)).toHaveLength(2); // 502 even: 10 pages of 50, then 2
  // the api walks any tab in pages, past 1000
  const a = (await call("api page 1", "/api/journal?limit=1000", { token: agent })).body;
  expect(a.rows).toHaveLength(1000);
  expect(a.next_offset).toBe(1000);
  const b = (await call("api page 2", "/api/journal?limit=1000&offset=1000", { token: agent })).body;
  expect(b.rows.map((r: any) => r.n)).toEqual([5, 4, 3, 2, 1]);
  expect(b.next_offset).toBe(null);
  writeFileSync(join(artifacts, "page-journal.html"), first);
  for (let k = 0; k < ns.length; k += 50) {
    const ids = (await call("notes ids", `/api/journal?limit=50`, { token: agent })).body.rows.map((r: any) => r.id);
    await Promise.all(ids.map((id: number) => call("delete note", `/api/journal/${id}`, { method: "DELETE", token: agent })));
  }
  expect((await call("drop notes", "/api/_tabs/journal", { method: "DELETE", token: agent })).status).toBe(200);
}, 120_000);

test("predictions open on the score, then every open bet counting down with its confidence; scoring one (by the agent) moves it", async () => {
  const token = await me();
  const page = (await call("predictions page", "/predictions", { token })).body as string;
  // the score first, big, as counts: 1 of 1 came true, next to how sure you said you were
  expect(page).toContain('<div class="score"><div><p class="big">1 of 1</p><p class="sub">came true</p></div><div><p class="big said">80%</p><p class="sub">you said, on average</p></div></div>');
  expect(page.indexOf('class="score"')).toBeLessThan(page.indexOf('<span class="pill">upcoming</span>'));
  // upcoming: every open one, overdue first, each with its confidence; the overdue one in red
  const upcoming = page.split('<h2><span class="pill">upcoming</span></h2>')[1].split("</section>")[0];
  expect(upcoming.indexOf("Overdue bet")).toBeLessThan(upcoming.indexOf("Due soon bet"));
  expect(upcoming.indexOf("Due soon bet")).toBeLessThan(upcoming.indexOf("Far away bet"));
  expect(upcoming).toContain('<small class="bad">overdue 10 days</small>');
  expect(upcoming).toContain('<li><span class="lead">80%</span><a href="/predictions/');
  expect(upcoming).not.toContain("Scored bet");
  const views = (await call("predictions views", "/api/predictions/_views", { token: await dots() })).body.views;
  expect(views.find((v: any) => v.kind === "calibration")).toMatchObject({ "avg confidence": "80%", "came true": "1 of 1" }); // the api keeps its numbers
  expect(views.find((v: any) => v.kind === "upcoming").rows[0]).toMatchObject({ title: "Overdue bet", overdue: true, confidence: 60 });
  // rows: open a white pill, closed outlined, right green, wrong red; confidence and the review under the title, no description
  expect(page).toContain('<span class="pill">open</span>');
  expect(page).toContain('<span><span class="pill good">right</span></span><span><span class="pill outline">closed</span></span>');
  expect(page).toContain("<span>80%</span><span>review in 5 days</span>");
  expect(page).toContain('<span><span class="bad">review overdue by 10 days</span></span>'); // past and still open
  expect(page).toContain("<span>reviewed 2 months ago</span>"); // past and scored
  expect(page).not.toContain('class="snippet"'); // no description under rows; "expected" stays searchable and on the row page
  const overdue = (await call("forecast rows", "/api/predictions?q=Overdue", { token })).body.rows[0];
  await send(await dots(), `/api/predictions/${overdue.id}`, { verdict: "wrong", status: "closed" }, "PATCH");
  const after = (await call("predictions page after scoring", "/predictions", { token })).body as string;
  expect(after.split('<h2><span class="pill">upcoming</span></h2>')[1].split("</section>")[0]).not.toContain("Overdue bet");
  expect(after).toContain("<span>reviewed 10 days ago</span>");
  expect(after).toContain('<p class="big">1 of 2</p><p class="sub">came true</p></div><div><p class="big said">70%</p>');
  expect(after).toContain('<span class="pill bad">wrong</span>');
  writeFileSync(join(artifacts, "page-predictions.html"), after);
});

test("reccos open on cards for what you're on and what's next, with who recommended each and its kind; everything else waits under the search", async () => {
  const token = await me(), agent = await dots();
  const add = async (row: Record<string, unknown>) => (await send(agent, "/api/reccos", row)).body.row;
  const bomb = await add({ title: "The Making of the Atomic Bomb", kind: "book", creator: "Richard Rhodes", status: "next", recommended_by: "priya" });
  await add({ title: "Perfect Days", kind: "movie", creator: "Wim Wenders", status: "next", recommended_by: "maya" });
  await add({ title: "Severance", kind: "show", status: "on it", recommended_by: "jules" });
  await add({ title: "Blueprint for Armageddon", kind: "podcast", creator: "Dan Carlin", status: "next" }); // no recommender: the corner stays empty
  await add({ title: "Thinking in Systems", kind: "book", status: "finished", recommended_by: "priya" });
  await add({ title: "Antifragile", kind: "book", status: "dropped" });
  expect((await send(agent, "/api/reccos", { title: "No Kind", status: "next" })).body.error).toStartWith('"kind" is required');
  expect((await send(agent, "/api/reccos", { title: "Bad Kind", kind: "game", status: "next" })).body.error).toStartWith('"kind" must be one of: book, movie, show, podcast, article');
  expect((await send(agent, "/api/reccos", { title: "Bad Status", kind: "book", status: "to read" })).body.error).toStartWith('"status" must be one of: next, on it, finished, dropped');
  // a cards view checks its definition like every view
  const bad = await send(token, "/api/_tabs/reccos-bad", { label: "x", about: "x", title: "title", fields: [{ name: "title", type: "text" }, { name: "status", type: "enum", options: ["a", "b"] }], views: [{ kind: "cards", field: "status", show: ["c"] }] }, "PUT");
  expect(bad.body.error).toContain('"show" must list values of "status"');

  const cards = (html: string) => html.split('<div class="cards">')[1]?.split("</div>")[0] ?? "";
  const cardTitles = (html: string) => [...cards(html).matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  const page = (await call("reccos page", "/reccos", { token })).body as string;
  // on it first and outlined, then next newest first; finished and dropped have no card
  expect(cardTitles(page)).toEqual(["Severance", "Blueprint for Armageddon", "Perfect Days", "The Making of the Atomic Bomb"]);
  expect(cards(page).match(/class="card first"/g)?.length).toBe(1);
  expect(cards(page)).toContain('<a class="card first" href="/reccos/');
  for (const k of ["show", "podcast", "movie", "book"]) expect(cards(page)).toContain(`aria-label="${k}"`);
  expect(cards(page)).toContain('<span class="sub">Richard Rhodes</span>');
  expect(cards(page)).toContain("<span>maya</span>");
  expect(cards(page)).not.toContain('<span class="pill">'); // no heading: the cards are the page
  // under the search: every recco, the two without cards included
  const log = page.split('<div class="rows">')[1];
  for (const t of ["Severance", "Perfect Days", "Thinking in Systems", "Antifragile"]) expect(log).toContain(t);
  // the api gives the same cards as data, for an agent that wants "what's next"
  const views = (await call("reccos views", "/api/reccos/_views", { token: agent })).body;
  const v = views.views.find((x: any) => x.kind === "cards");
  expect(v.rows.map((r: any) => r.title)).toEqual(cardTitles(page));
  expect(v.rows[0]).toMatchObject({ title: "Severance", status: "on it", kind: "show", recommended_by: "jules" });
  expect((await call("search reccos by who recommended", "/api/reccos?q=priya", { token: agent })).body.rows.map((r: any) => r.title).sort()).toEqual(["The Making of the Atomic Bomb", "Thinking in Systems"]);

  // one row for its whole life: start it, it joins the outlined ones; finish it, its card goes and it stays in the list
  await send(agent, `/api/reccos/${bomb.id}`, { status: "on it" }, "PATCH");
  const started = (await call("reccos page after starting", "/reccos", { token })).body as string;
  expect(cardTitles(started)).toEqual(["Severance", "The Making of the Atomic Bomb", "Blueprint for Armageddon", "Perfect Days"]); // on it now, outlined, newest added first among them
  await send(agent, `/api/reccos/${bomb.id}`, { status: "finished" }, "PATCH");
  const done = (await call("reccos page after finishing", "/reccos", { token })).body as string;
  expect(cardTitles(done)).not.toContain("The Making of the Atomic Bomb");
  expect(done.split('<div class="rows">')[1]).toContain("The Making of the Atomic Bomb");
  expect((await call("finished recco row", `/reccos/${bomb.id}`, { token })).body).toContain("priya");
  writeFileSync(join(artifacts, "page-reccos.html"), started);
});

test("garmin fills health: full backfill under the request cap, merged days, intraday detail, metrics that judge the week", async () => {
  const token = await me(), agent = await dots();
  // before garmin's first run, sessions the agent already logged (more in beforeAll): a walk that garmin calls a hike, and an
  // old-style row with only a date, written while the tab still allowed that
  await send(agent, "/api/training", { at: `${day(-8)}T09:30-08:00`, type: "other", title: "walk with friends", notes: "knee felt fine" });
  const { slug: _s, position: _p, ...training } = (await call("training schema", "/api/_tabs/training", { token })).body.tab;
  const untimed = { ...training, fields: training.fields.map(({ time: _t, ...f }: any) => f) };
  expect((await send(token, "/api/_tabs/training", untimed, "PUT")).status).toBe(200);
  expect((await send(agent, "/api/training", { at: day(-3), type: "run", title: "tempo run", distance_km: 7, rpe: 7 })).status).toBe(201);
  expect((await send(token, "/api/_tabs/training", training, "PUT")).status).toBe(200);
  const HOUR = 3_600_000;
  const base = Math.floor(Date.now() / HOUR / 3) * 3 * HOUR + 17 * 60_000; // an hour that checks recent days (every 3rd)
  const runs: { at: string; recent: boolean; calls: number }[] = [];
  const run = async (at: number) => {
    const before = garmin.calls.length;
    // local dev's cron trigger (what the local explorer's "run" button calls), at a chosen time
    const r = await fetch(`http://localhost:${port}/cdn-cgi/local/scheduled?${new URLSearchParams({ cron: "17 * * * *", time: String(at), format: "json" })}`);
    if (r.status !== 200) throw new Error(`scheduled: ${r.status} ${await r.text()}`); // a sync that throws fails the run
    runs.push({ at: new Date(at).toISOString(), recent: Math.floor(at / HOUR) % 3 === 0, calls: garmin.calls.length - before });
  };
  // keep running hourly until nothing is owed: a run that checks recent days, then two that only backfill
  for (let i = 0; i < 30; i++) await run(base + i * HOUR);
  writeFileSync(join(artifacts, "garmin-runs.json"), JSON.stringify(runs, null, 1));
  expect(Math.max(...runs.map((r) => r.calls))).toBeLessThanOrEqual(48); // the free plan allows 50 outside requests a run
  const idle = runs.filter((r) => !r.recent).at(-1)!;
  expect(idle.calls).toBe(0); // backfill finished: an hour that doesn't check recent days asks garmin nothing
  expect(runs.filter((r) => r.recent).at(-1)!.calls).toBeLessThanOrEqual(17); // steady state: 1 token + 6 + 2 days of detail (4 each) + the activity list
  expect(garmin.calls.filter((c) => c.includes("dailySleepSummariesByDate")).length).toBeGreaterThan(0);

  // every worn day, once: the full history, no duplicates although recent days were stored many times, no row for the unworn day
  const rows: any[] = [];
  for (let offset = 0; offset !== null;) { const page = (await call("health rows", `/api/health?limit=1000&offset=${offset}`, { token: agent })).body; rows.push(...page.rows); offset = page.next_offset; }
  const dates = rows.map((r) => r.date);
  expect(new Set(dates).size).toBe(dates.length);
  const iso = (n: number) => day(-n); // n days ago, in pacific time like the fake garmin
  expect(dates).not.toContain(iso(NOT_WORN));
  expect(dates).toContain(iso(HISTORY)); // the oldest day: the backfill walked back three chunks and stopped after three empty ones
  expect(rows.length).toBe(HISTORY); // HISTORY + 1 days, minus the unworn one
  const day3 = rows.find((r) => r.date === iso(3));
  // mapped from five range calls, the day summary and fitness age (newest day only); vo2max failed every time and nothing else did
  expect(day3).toMatchObject({ hrv_ms: numbers(iso(3)).hrv, resting_hr: 46, steps: numbers(iso(3)).steps, intensity_min: 40, stress_rest_min: 420,
    sleep_deep_min: 90, sleep_score: 84, bedtime: `${iso(4)}T23:40`, sleep_feedback: "positive optimal structure",
    sleep_insight: "stress pos excellent or good sleep restful day", hrv_feedback: "hrv balanced", body_battery_feedback: "sleep time passed balanced and inactive",
    sedentary_min: 690, active_min: 60, body_battery_at_wake: 91, updated_by: "garmin" });
  expect(day3.vo2max).toBeUndefined();
  // merge: the recent run re-stored day 1 after its summary was fetched, and the summary's fields survived
  expect(rows.find((r) => r.date === iso(1)).sedentary_min).toBe(690);
  // old days: numbers and the day summary, no intraday (garmin dropped it), and an empty series so they stop being owed
  const old = rows.find((r) => r.date === iso(HISTORY));
  expect(old.sedentary_min).toBe(690);
  expect((await call("old day series", `/api/health/${old.id}/series`, { token: agent })).body.series).toEqual({});

  // a day's intraday detail, in minutes from local midnight: the null reading and the 40-minute gap are skipped, overnight hrv starts the night before
  const series = (await call("day series", `/api/health/${day3.id}/series`, { token: agent })).body.series;
  expect(series["heart rate"].points).toHaveLength(720 - 20 - 1);
  expect(series["heart rate"].points[0]).toEqual([0, 55]);
  expect(series["overnight hrv"].points[0]).toEqual([-20, 60]);
  expect(series["body battery"].points.map((p: number[]) => p[0])).toEqual([0, 468, 573, 954, 1431]);

  // the day page: sections, the sleep and stress bars, timelines with the watch-off gap left open
  const page = (await call("health day page", `/health/${day3.id}`, { token })).body as string;
  for (const s of ["recovery", "sleep", "activity"]) expect(page).toContain(`<h2><span class="pill">${s}</span></h2>`);
  expect(page).not.toContain('<span class="pill">fitness</span>'); // no fitness numbers that day: no empty section
  expect(page).toContain("<dt>respiration low</dt>");
  expect(page).toContain('title="deep"');
  expect(page).toContain("<span>deep 1h 30m</span>");
  expect(page).toContain("<span>rest 7h</span>");
  expect(page).toContain("positive optimal structure");
  const hr = page.split("<h2>heart rate</h2>")[1].split("</section>")[0];
  expect(hr.match(/<polyline /g)).toHaveLength(2); // before and after the gap
  expect(hr).toContain(">12am</text>");
  expect(page.split("<h2>overnight hrv</h2>")[1].split("</section>")[0]).toContain(">11:40pm</text>");
  expect(page.split("<h2>body battery</h2>")[1].split("</section>")[0].match(/<polyline /g)).toHaveLength(1); // hours apart, still one line
  writeFileSync(join(artifacts, "page-health-day.html"), page);

  // the tab page: this week judged against the 28 days before it, in the right direction for each metric
  const tabPage = (await call("health page", "/health", { token })).body as string;
  const row = (name: string) => tabPage.split(`href="/health/metrics/${name}">`)[1].split("</a>")[0];
  const word = (name: string) => row(name).split('<span class="why">')[1].split("</span>")[0];
  // each metric is one line: the judged day's value, one short verdict, the 14-day box; the verdict comes from garmin first
  expect(word("hrv_ms")).toBe("<span>balanced"); // garmin's hrv status, as garmin says it; balanced isn't coloured
  expect(word("sleep_score")).toBe("<span>good"); // garmin's sleep score label
  expect(row("sleep_score")).toContain('<span class="val">84</span>');
  expect(word("body_battery_at_wake")).toBe('<span class="good">high'); // 91: garmin's high reserve band (76 to 100)
  expect(row("body_battery_at_wake")).toContain('<span class="val good">91</span>');
  expect(word("stress_avg")).toBe("<span>low"); // 45: garmin's low stress band (26 to 50)
  // steps against garmin's goal for the finished day (yesterday), today shown as so far
  expect(word("steps")).toBe(`<span>${(10000 - numbers(iso(1)).steps).toLocaleString("en-US")} short of goal`);
  expect(row("steps")).toContain(`<span>yesterday</span><span>today so far ${numbers(iso(0)).steps.toLocaleString("en-US")}</span>`);
  // intensity: the week ending yesterday against garmin's weekly goal, in plain minutes
  expect(row("intensity_min")).toContain('<span class="val good">280 min</span>');
  expect(word("intensity_min")).toBe('<span class="good">280 of 150 min this week');
  // resting hr: garmin gives no verdict, so your own history: this week's 46 sits inside the low end of the last 28 days
  expect(row("resting_hr")).toContain('46 bpm</span>');
  expect(word("resting_hr")).toMatch(/^<span( class="good")?>(usual|lower than usual)$/);
  // the box: 14 dots and a line; the band only where the verdict is your own history
  expect(row("hrv_ms").match(/<circle /g)).toHaveLength(14 - (NOT_WORN < 14 ? 1 : 0));
  expect(row("hrv_ms").match(/<polyline /g)).toHaveLength(1);
  expect(row("hrv_ms")).not.toContain('<rect class="usual"');
  expect(row("resting_hr")).toContain('<rect class="usual"');
  expect(row("body_battery_at_wake")).toContain('<circle class="today good"');
  expect(tabPage).not.toContain('href="/health/metrics/weight_kg"'); // weigh-ins live in body now
  expect(tabPage).not.toContain('href="/health/metrics/vo2max"'); // never had a value: no row
  expect(tabPage).not.toContain("data-chart"); // the dashboard is static svg; the charts live a click away
  expect(tabPage.indexOf("recovery")).toBeLessThan(tabPage.indexOf('<form class="search"'));
  // the log: each day as its big picture from the same verdicts (at most two, bad first)
  const logRow = (date: string) => tabPage.split('<div class="rows">')[1].split("</li>").find((li) => li.includes(`href="/health/${rows.find((r) => r.date === date).id}"`))!;
  expect(logRow(iso(0))).toContain('<small class="aside words"><span class="good">well recovered</span></small>'); // body battery high; today's steps aren't judged
  expect(logRow(iso(20))).toContain('<span class="good">well recovered</span><span class="good">active day</span>'); // 11,460 steps, over the goal
  writeFileSync(join(artifacts, "page-health.html"), standalone(tabPage));
  // the full page: the value and its verdict, then the chart (streams at 1d / 3d, then every day, your usual as dashed lines)
  const hrPage = (await call("resting hr page", "/health/metrics/resting_hr", { token })).body as string;
  const heart = charts(hrPage)[0];
  expect(heart.streams.map((s: any) => s.date)).toEqual([iso(2), iso(1), iso(0)]);
  expect(heart.points).toHaveLength(HISTORY);
  expect(heart.usual[0]).toBeLessThan(heart.usual[1]);
  for (const r of ["1d", "3d", "10d", "1m", "3m", "1y", "all"]) expect(hrPage).toContain(`>${r}</button>`);
  expect(hrPage).toMatch(/<p class="verdict"><span class="(good)?">46 bpm<\/span> <span class="(good)?">(usual|lower than usual)<\/span><\/p>/);
  expect(hrPage).not.toContain("your usual is"); // no narration
  writeFileSync(join(artifacts, "page-health-heart.html"), standalone(hrPage));
  const hist = (await call("metric page", "/health/metrics/hrv_ms", { token })).body as string;
  const full = charts(hist)[0];
  expect(full.points[0][0]).toBe(iso(HISTORY));
  expect(full.base).toBe("/health/");
  expect(full.usual).toBeUndefined(); // judged by garmin's status, so no band of your own
  expect(hist).toContain('<p class="verdict"><span class="">');
  expect(hist).not.toContain("best week"); // the chart shows it; no words for it
  const stepsPage = (await call("steps page", "/health/metrics/steps", { token })).body as string;
  expect(stepsPage).not.toContain(">1d</button>"); // no stream, no 1d / 3d
  writeFileSync(join(artifacts, "page-health-metric.html"), standalone(hist));
  expect((await call("unknown metric", "/health/metrics/nope", { token })).status).toBe(404);
  // a tab that stopped syncing a month ago has no "today": its newest day reads as its date, and a tally isn't "so far"
  const stale = { label: "stale", about: "stopped syncing", title: "date", sort: "date", fields: [{ name: "date", type: "date", required: true },
    { name: "pulse", type: "int", unit: "bpm" }, { name: "walks", type: "int" }],
    views: [{ kind: "metrics", label: "old", metrics: [{ field: "pulse", better: "lower" }, { field: "walks", better: "higher", finished: true }] }] };
  expect((await send(agent, "/api/_tabs/stale", stale, "PUT")).status).toBe(201);
  for (let n = 30; n < 50; n++) await send(agent, "/api/stale", { date: iso(n), pulse: 50 + (n % 3), walks: 1000 + n });
  const stalePage = (await call("stale tab page", "/stale", { token })).body as string;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][new Date(iso(30)).getUTCMonth()];
  expect(stalePage).not.toContain("<span>today</span>");
  expect(stalePage).not.toContain("so far");
  expect(stalePage).toContain(`<span>${month} ${new Date(iso(30)).getUTCDate()}</span>`);
}, 240_000);

test("garmin's activities and the agent's sessions are one log: merged both ways, garmin's measurements, the agent's words", async () => {
  const token = await me(), agent = await dots();
  const all = async () => {
    const rows: any[] = [];
    for (let o = 0; o !== null;) { const p = (await call("training rows", `/api/training?limit=1000&offset=${o}`, { token: agent })).body; rows.push(...p.rows); o = p.next_offset; }
    return rows;
  };
  let rows = await all();
  const by = (id: number) => rows.find((r) => r.garmin_id === id);
  // every activity once, although the recent checks and the backfill pages listed many of them more than once
  const ids = rows.map((r) => r.garmin_id).filter((x) => x !== undefined);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBe(garmin.activities.length);
  // the agent first, timed: its 18:00 chest day and garmin's 18:20 strength are one row; garmin's start and heart rate, the agent's words
  const chest = by(9008);
  expect(chest).toMatchObject({ at: `${day(-20)}T18:20-08:00`, title: "chest", type: "strength", focus: "chest, arms", duration_min: 58, avg_hr: 110, training_effect: "aerobic base" });
  expect(chest.lifts).toContain("tricep pushdown");
  // the agent's own measurement yields to the watch's (5.2 km by hand, 5.04 measured); what you told the watch sits beside the agent's rpe
  expect(by(9002)).toMatchObject({ title: "easy run", focus: "legs", distance_km: 5.04, duration_min: 31, watch_rpe: 5, watch_feel: "normal",
    stamina_start: 97, stamina_end: 61, fastest_5k_s: 1702, hr_zone_1_min: 5, hr_zone_2_min: 16, intensity_min: 26 });
  // an old row with only a date matches on the day, and takes garmin's time
  expect(by(9003)).toMatchObject({ title: "tempo run", rpe: 7, distance_km: 7.5, at: `${day(-3)}T18:00-08:00` });
  // the agent's "walk" at 09:30 pairs with the 09:53 hike, the closer start; its type stays the agent's; the 08:00 hike is a row of its own
  expect(by(9006)).toMatchObject({ title: "walk with friends", type: "other", garmin_type: "hiking", elevation_m: 963, notes: "knee felt fine" });
  expect(by(9005)).toMatchObject({ title: "mariposa county hiking", type: "hike" });
  // 3.5 hours apart is two sessions: the 21:30 strength didn't take the agent's 18:00 chest day
  expect(by(9007).title).toBe("strength");
  expect(rows.find((r) => r.at === `${day(-13)}T18:00-08:00`).garmin_id).toBeUndefined();
  // garmin alone: its type mapped to the tab's, its name as the title
  expect(by(9004)).toMatchObject({ type: "run", title: "menlo park running", updated_by: "garmin" });
  expect(by(9009).type).toBe("swim");
  expect(by(9010).type).toBe("sport");
  // the agent alone: a legs day with no activity that day stays as it was
  expect(rows.find((r) => r.title === "legs").garmin_id).toBeUndefined();

  // garmin first: the watch synced the strength session, then the agent logs it an hour later; one row, garmin's duration and start
  const logged = await send(agent, "/api/training", { at: `${day(-5)}T19:05-08:00`, type: "strength", title: "back", focus: "back", lifts: "pull up: bwx10, bwx8", duration_min: 50, rpe: 8 });
  expect(logged.status).toBe(200);
  expect(logged.body.merged).toBe("garmin");
  expect(logged.body.row).toMatchObject({ id: by(9001).id, garmin_id: 9001, title: "back", duration_min: 65, at: `${day(-5)}T18:00-08:00`, rpe: 8, watch_rpe: 7, watch_feel: "strong" });
  // a second session that evening is its own row: the garmin row already has the agent's words
  expect((await send(agent, "/api/training", { at: `${day(-5)}T20:30-08:00`, type: "run", title: "shakeout", duration_min: 15 })).status).toBe(201);
  // a session needs its time now
  expect((await send(agent, "/api/training", { at: day(-1), type: "run" })).body.error).toBe('"at" needs a date and time with its offset, like 2026-11-18T09:30-08:00');

  // weigh-ins: one on a day the agent logged nothing, and yesterday's hand-logged 69.4 becomes the scale's 69.8 at 07:30
  const body = (await call("body rows", "/api/body?limit=100", { token: agent })).body.rows;
  expect(body.find((r: any) => r.garmin_id === 501)).toMatchObject({ at: `${day(-20)}T07:30-08:00`, bodyweight_kg: 70.1, bodyfat_percentage: 15.2 });
  expect(body.find((r: any) => r.garmin_id === 502)).toMatchObject({ at: `${day(-1)}T07:30-08:00`, bodyweight_kg: 69.8 });
  expect(body.filter((r: any) => r.at.startsWith(day(-1)))).toHaveLength(1);

  // deleted in garmin: the run only garmin knew goes; the chest day the agent wrote to stays, unlinked, with its numbers
  const gone = by(9004).id;
  for (const id of [9004, 9008]) garmin.activities.splice(garmin.activities.findIndex((a) => a.list.activityId === id), 1);
  const HOUR = 3_600_000, at = Math.floor(Date.now() / HOUR / 3) * 3 * HOUR + 17 * 60_000 + 33 * HOUR; // an hour that checks recent days
  const r = await fetch(`http://localhost:${port}/cdn-cgi/local/scheduled?${new URLSearchParams({ cron: "17 * * * *", time: String(at), format: "json" })}`);
  expect(r.status).toBe(200);
  rows = await all();
  expect(rows.find((x) => x.id === gone)).toBeUndefined();
  const kept = rows.find((x) => x.id === chest.id);
  expect(kept.garmin_id).toBeUndefined();
  expect(kept).toMatchObject({ title: "chest", avg_hr: 110 });
  writeFileSync(join(artifacts, "training-merged.json"), JSON.stringify(rows.filter((x) => x.at >= day(-41)).sort((a, b) => (a.at < b.at ? 1 : -1)), null, 1));
  const runPage = await call("garmin run page", `/training/${by(9002).id}`, { token });
  expect(runPage.status).toBe(200);
  expect(runPage.body).toContain("avg hr");
  writeFileSync(join(artifacts, "page-training-run.html"), runPage.body);
  writeFileSync(join(artifacts, "page-training-garmin.html"), standalone((await call("training page", "/training", { token })).body));
}, 60_000);

test("training opens on what an agent needs, and /_views gives it the same numbers: load, the run limit, weeks, records", async () => {
  const token = await me(), agent = await dots();
  // a session the agent logged with no time and no watch: it still happened
  expect((await send(agent, "/api/training", { at: `${day(-1)}T19:30-08:00`, type: "climb", title: "bouldering" })).status).toBe(201);
  const views = (await call("training views", "/api/training/_views", { token: agent })).body.views;
  const view = (kind: string) => views.find((v: any) => v.kind === kind);
  writeFileSync(join(artifacts, "training-views.json"), JSON.stringify(views, null, 1));
  // load: the last 7 days (strength 85 + runs 55 and 41) against your own past weeks, mostly one or two easy runs
  expect(view("load")).toMatchObject({ last_7_days: 181, verdict: "higher than usual" });
  expect(view("load").weeks).toHaveLength(12);
  // the run limit: the longest run of the last 30 days and the next one's limit; 7.5 km went 21% past the 6.2 before it,
  // while 6.2 (8.8% past 5.7) and 5.7 (9.6% past 5.2) stayed just under 10%
  expect(view("limit")).toMatchObject({ label: "run limit", days: 30, over_percent: 10, longest: { value: 7.5, on: day(-3) }, next_under: 8.25 });
  expect(view("limit").over_the_limit).toEqual([{ value: 7.5, on: day(-3), id: expect.any(Number), longest_before: 6.2, percent_over: 21 }]);
  // weeks: per sport, 7-day weeks; this week's running is the two garmin runs plus the agent's shakeout (no watch)
  const run = view("weeks").sports.run;
  expect(run.duration_min.at(-1)).toBe(31 + 42 + 15);
  expect(run.distance_km.at(-1)).toBe(12.54);
  expect(view("weeks").zones_last_28_days.hr_zone_2_min).toBeGreaterThan(0);
  expect(view("weeks").sports.climb.sessions.at(-1)).toBe(1);
  expect(view("weeks").sports.climb.duration_min.at(-1)).toBe(0);
  // records: best ever next to the best of the last 90 days
  const record = (label: string) => view("records").records.find((r: any) => r.label === label);
  expect(record("fastest 5 km")).toMatchObject({ best_ever: { value: 1615, shown: "26:55", on: day(-95) }, best_last_90_days: { value: 1702, shown: "28:22" } });
  expect(record("longest run")).toMatchObject({ best_ever: { value: 21.1, on: day(-150) }, best_last_90_days: { value: 7.5 } });
  expect(record("fastest 10 km")).toMatchObject({ best_ever: { shown: "58:20" }, best_last_90_days: null });
  expect(record("most climbing").best_ever).toEqual(record("most climbing").best_last_90_days);
  expect(record("longest ride")).toBeUndefined(); // never ridden: no record

  // load, the run limit and weeks are the agent's (page: false): off the page, which still opens on sessions, progress,
  // bodyweight and records; drawn, they'd show exactly those numbers (the same computation)
  const shown = (await call("training page", "/training", { token })).body as string;
  for (const label of ["load", "run limit", "weeks"]) expect(shown).not.toContain(`<span class="pill">${label}</span>`);
  for (const label of ["sessions", "progress", "records"]) expect(shown).toContain(`<span class="pill">${label}</span>`);
  expect(view("load").on_page).toBe(false);
  expect(view("records").on_page).toBe(true);
  const { slug: _s, position: _p, ...def } = (await call("training schema", "/api/_tabs/training", { token })).body.tab;
  expect((await send(token, "/api/_tabs/training", { ...def, views: def.views.map(({ page: _x, ...v }: any) => v) }, "PUT")).status).toBe(200);
  const page = (await call("training page, every view drawn", "/training", { token })).body as string;
  expect((await send(token, "/api/_tabs/training", def, "PUT")).status).toBe(200);
  const block = (label: string) => page.split(`<span class="pill">${label}</span></h2>`)[1].split("</section>")[0];
  expect(block("load")).toContain('<span class="name">7 days</span><span class="val">181</span><span class="why"><span>higher than usual</span>');
  expect(block("run limit")).toContain('<span class="name">next under</span><span class="val">8.3 km</span>');
  expect(block("run limit")).toContain('<span class="val bad">7.5 km</span><span class="why"><span class="bad">21% past the longest before it, 6.2 km</span>');
  expect(block("weeks")).toContain('<span class="name">run</span><span class="val">1h 28m</span><span class="why"><span>12.5 km</span><span>7 days</span>');
  expect(block("weeks")).toContain('<span class="name">climb</span><span class="val">no time logged</span>');
  expect(block("records")).toContain('<span class="name">fastest 5 km</span><span class="val">28:22</span>');
  expect(block("records")).toContain("<span>best 26:55");
  expect(block("records")).toContain('<span class="name">most climbing</span><span class="val good">963 m</span>');
  expect(page.indexOf('<span class="pill">records</span>')).toBeLessThan(page.indexOf('<form class="search"')); // right above search
  writeFileSync(join(artifacts, "page-training-views.html"), standalone(page));

  // health: the agent reads the page's verdicts instead of redoing the maths over raw rows
  const health = (await call("health views", "/api/health/_views", { token: agent })).body.views;
  const healthPage = (await call("health page again", "/health", { token })).body as string;
  const all = health.flatMap((v: any) => v.metrics);
  expect(all.find((m: any) => m.field === "sleep_score")).toMatchObject({ value: 84, shown: "84", verdict: "good" });
  for (const m of all) expect(healthPage).toContain(`href="/health/metrics/${m.field}"><span class="name">${m.name}</span><span class="val${m.tone ? ` ${m.tone}` : ""}">${m.shown}</span>`);
  writeFileSync(join(artifacts, "health-views.json"), JSON.stringify(health, null, 1));

  // a run's page: garmin's numbers under headings, seconds as times, the link to garmin kept out of sight
  const rows = (await call("runs", "/api/training?q=easy%20run", { token: agent })).body.rows;
  const runPage = (await call("run page", `/training/${rows[0].id}`, { token })).body as string;
  for (const s of ["effort", "pace", "zones"]) expect(runPage).toContain(`<h2><span class="pill">${s}</span></h2>`);
  expect(runPage).toContain("<dt>fastest 5k</dt><dd>28:22</dd>");
  expect(runPage).toContain("<dt>training load</dt><dd>41</dd>");
  expect(runPage).not.toContain("garmin id");
  expect(rows[0].garmin_id).toBe(9002); // still in the api
  writeFileSync(join(artifacts, "page-training-run.html"), runPage);
  expect((await call("views of an unknown tab", "/api/nope/_views", { token: agent })).status).toBe(404);
});

test("people link to companies, events and each other by name, and their page opens on the graph", async () => {
  const token = await me(), agent = await instinct();
  const count = async (tab: string) => (await call(`count ${tab}`, `/api/${tab}?limit=1000`, { token })).body.rows.length;
  // the seeds already made their companies and event: a name with no row creates it
  expect(await count("companies")).toBe(2);
  expect((await call("seeded event", "/api/events", { token })).body.rows.map((r: any) => r.name)).toEqual(["space week"]);

  // names match ignoring case and are stored as the row's own title; a new name makes its row; nobody knows themself
  const gil = await send(agent, "/api/people", { name: "Gil Graph", company: "example labs", met_where: "Space Week", referred_by: "ben sample", knows: ["Ada Example", "Hal New", "gil graph", "ada example"] });
  expect(gil.status).toBe(201);
  expect(gil.body.row).toMatchObject({ company: "Example Labs", met_where: "space week", referred_by: "Ben Sample", knows: ["Ada Example", "Hal New"] });
  expect(await count("companies")).toBe(2);
  const hal = (await call("hal was made", "/api/people?q=Hal%20New", { token })).body.rows.filter((r: any) => r.name === "Hal New");
  expect(hal.length).toBe(1); // the search also finds gil, who knows hal
  expect(hal[0].updated_by).toBe("service:instinct-client-id");

  // one title means one row: a second "example labs" is refused, so is a person with someone else's name
  const dupe = await send(agent, "/api/companies", { name: "EXAMPLE LABS" });
  expect(dupe.status).toBe(409);
  expect(dupe.body.error).toContain('already has "Example Labs"');
  expect((await send(agent, "/api/people", { name: "hal new" })).status).toBe(409);
  for (const [body, why] of [[{ knows: 5 }, "must be a list of titles"], [{ company: ["a", "b"] }, "must be the title of a row in companies"]] as const) {
    const r = await send(agent, `/api/people/${gil.body.row.id}`, body, "PATCH");
    expect(r.status).toBe(400);
    expect(r.body.error).toContain(why);
  }
  expect((await send(token, "/api/_tabs/scratch", { label: "scratch", about: "", fields: [{ name: "name", type: "text" }, { name: "boss", type: "ref", to: "nowhere" }] }, "PUT")).body.error).toContain('no tab "nowhere"');

  // a rename rewrites every link to it, in single refs and in lists
  const labs = (await call("labs", "/api/companies?q=Example%20Labs", { token })).body.rows[0];
  expect((await send(agent, `/api/companies/${labs.id}`, { name: "Example Orbital", about: "small satellites" }, "PATCH")).status).toBe(200);
  const ada = (await call("ada", "/api/people?q=Ada%20Example", { token })).body.rows.find((r: any) => r.name === "Ada Example");
  expect((await send(agent, `/api/people/${ada.id}`, { name: "Ada Lovelace" }, "PATCH")).body.row.company).toBe("Example Orbital");
  expect((await call("gil after renames", `/api/people/${gil.body.row.id}`, { token })).body.row).toMatchObject({ company: "Example Orbital", knows: ["Ada Lovelace", "Hal New"] });

  // a row something links to stays until the links go
  const kept = await call("delete a linked company", `/api/companies/${labs.id}`, { method: "DELETE", token: agent });
  expect(kept.status).toBe(409);
  expect(kept.body.error).toContain("people.company (2 rows)");
  const unused = await send(agent, "/api/companies", { name: "Nobody Works Here" });
  expect((await call("delete an unlinked company", `/api/companies/${unused.body.row.id}`, { method: "DELETE", token: agent })).status).toBe(200);

  // the graph, as an agent reads it: every person, company and event a node, every link an edge
  const views = (await call("people views", "/api/people/_views", { token: agent })).body.views;
  expect(views.map((v: any) => [v.kind, v.label, v.on_page])).toEqual([["graph", "connections", true]]);
  const g = views[0], name = new Map(g.nodes.map((n: any) => [n.id, n.label]));
  expect(g.tabs.map((t: any) => t.slug)).toEqual(["people", "companies", "events"]);
  const edges = g.edges.map((e: any) => `${name.get(e.from)} -${e.field}-> ${name.get(e.to)}`).sort();
  expect(edges).toEqual([
    "Ada Lovelace -company-> Example Orbital", "Ada Lovelace -met_where-> space week", "Ben Sample -company-> Sample VC",
    "Gil Graph -company-> Example Orbital", "Gil Graph -knows-> Ada Lovelace", "Gil Graph -knows-> Hal New",
    "Gil Graph -met_where-> space week", "Gil Graph -referred_by-> Ben Sample",
  ]);
  expect(g.nodes.find((n: any) => n.label === "Example Orbital").data).toEqual({ about: "small satellites" });
  expect(g.nodes.find((n: any) => n.label === "Cy Placeholder")).toBeTruthy(); // nobody linked yet, still a node

  // the page: the graph on top, drawn by the library the worker serves, and the groups under it
  const page = (await call("people page", "/people", { token })).body as string;
  expect(page).toContain('<section class="view"><div class="graph" data-graph="'); // no heading pill over it
  expect(page).not.toContain('<span class="pill">connections</span>');
  expect(page).toContain('<script src="/_graph-3.35.0-fcose-2.2.0.js"></script>');
  expect(page).toContain("● people</span><span>■ companies</span><span>◆ events");
  const lib = await fetch(`http://localhost:${port}/_graph-3.35.0-fcose-2.2.0.js`, { headers: { "cf-access-jwt-assertion": token } });
  expect(lib.headers.get("cache-control")).toContain("immutable");
  const text = await lib.text();
  for (const part of ["cytoscape", "layoutBase", "coseBase", "cytoscapeFcose"]) expect(text).toContain(part);
  const list = page.split('<div class="rows">')[1];
  expect(list).toContain("<summary>space &amp; deep tech</summary>");
  expect(list).toContain("<summary>no group</summary>");
  expect(list).not.toContain('href="/companies'); // in the list only a row's title is a link
  // a topic nobody defined anywhere: the agent just writes it, and it becomes a group
  await send(await dots(), "/api/people", { name: "Eve New", group: "climate" });
  expect((await call("people page after new topic", "/people", { token })).body).toContain("<summary>climate</summary>");
  // a person's page links each name to its row
  const gilPage = (await call("gil's page", `/people/${gil.body.row.id}`, { token })).body as string;
  expect(gilPage).toContain('<a href="/companies?q=Example%20Orbital">Example Orbital</a>');
  expect(gilPage).toContain('<a href="/people?q=Ada%20Lovelace">Ada Lovelace</a>, <a href="/people?q=Hal%20New">Hal New</a>');
  writeFileSync(join(artifacts, "page-people.html"), standalone(page));
});

test("tabs keep fixed titles; obsessions' and health's descriptions are live, worked out from the birthday secret; home goes obsessions first", async () => {
  const token = await me();
  await findHere();
  const home = (await call("home names", "/", { token })).body as string;
  // fixed titles over their descriptions, in this order: what you live for first, then the body, then everyone else
  const order = [["obsessions", feltLeft()], ["training", "entropy"], ["health", weeksLeft()], ["people", "sonder"], ["predictions", "receipts"], ["reccos", "conversations with the dead"]];
  for (const [slug, about] of order) expect(home).toContain(`<a href="/${slug}"><span>${slug}</span></a>\n            <p>${about}</p>`);
  const at = order.map(([slug]) => home.indexOf(`href="/${slug}"`));
  expect(at).toEqual([...at].sort((x, y) => x - y));
  expect((await call("old path", "/forecasts", { token })).status).toBe(404); // renamed, no alias
  // the agents see the same in GET /api; the definition keeps what was written and says it's live
  const tabs = Object.fromEntries((await call("api names", "/api", { token: await instinct() })).body.tabs.map((t: any) => [t.slug, t]));
  expect(tabs.obsessions).toMatchObject({ label: "obsessions", about: feltLeft() });
  expect(tabs.health).toMatchObject({ label: "health", about: weeksLeft() });
  expect(tabs.training).toMatchObject({ label: "training", about: "entropy" });
  expect((await call("obsessions definition", "/api/_tabs/obsessions", { token })).body.tab).toMatchObject({ label: "obsessions", about: "what i live for", live: "felt_time_left" });
  // one row per obsession, the why under it; the page keeps its plain title
  const agent = await dots();
  await send(agent, "/api/obsessions", { obsession: "build things people use every day", why: "the feeling when a stranger depends on it" });
  await send(agent, "/api/obsessions", { obsession: "the annapurna circuit" });
  expect((await send(agent, "/api/obsessions", { why: "no obsession" })).body.error).toStartWith('"obsession" is required');
  const page = (await call("obsessions page", "/obsessions", { token })).body as string;
  expect(page).toContain("<h1>obsessions</h1>");
  for (const t of ["build things people use every day", "the annapurna circuit", "the feeling when a stranger depends on it"]) expect(page).toContain(t);
  writeFileSync(join(artifacts, "page-home.html"), home);
  writeFileSync(join(artifacts, "page-obsessions.html"), page);
  expect((await send(token, "/api/_tabs/scratch2", { label: "x", about: "", live: "years_left", fields: [{ name: "a", type: "text" }] }, "PUT")).body.error).toContain('"live" must be one of weeks_left, felt_time_left');
});

test("home is just the visible tabs, no numbers", async () => {
  const page = (await call("home", "/", { token: await me() })).body as string;
  for (const tab of ["people", "predictions", "training"]) expect(page).toContain(`href="/${tab}"`);
  for (const hidden of ["body", "companies", "events"]) expect(page).not.toContain(`href="/${hidden}"`);
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
    [{ ...thoughts, views: [{ kind: "weekly" }] }, "views[0]: kind must be one of progress, strip, line, upcoming, calibration, list"],
    [{ ...thoughts, views: [{ kind: "list", label: "now", where: { nope: "x" } }] }, 'views[0] (list): "where" must map fields to values'],
  ];
  for (const [d, message] of bad) expect((await send(token, "/api/_tabs/scratch", d, "PUT")).body.error).toStartWith(message);
  // order is data too: "after" puts a tab right after another on the home page
  const health = (await Bun.file(join(import.meta.dir, "fixtures", "tabs.json")).json()).health;
  expect((await send(token, "/api/_tabs/health", { ...health, after: "people" }, "PUT")).status).toBe(200);
  const home = (await call("home after reorder", "/", { token: await me() })).body as string;
  expect(home.indexOf('href="/health"')).toBeGreaterThan(home.indexOf('href="/people"'));
  expect(home.indexOf('href="/health"')).toBeLessThan(home.indexOf('href="/predictions"'));
  expect((await send(token, "/api/_tabs/health", { ...health, after: "nope" }, "PUT")).body.error).toBe('"after" must be the slug of another tab');
  const log = (await call("schema log", "/api/_log", { token })).body.changes;
  expect(log.slice(0, 3).map((c: any) => [c.tab, c.before === null ? "created" : "changed", c.by])).toEqual([
    ["health", "changed", "service:dots-client-id"], ["thoughts", "created", "service:dots-client-id"], ["body", "changed", "service:dots-client-id"],
  ]);
});

test("the pages are read-only: no forms, no write routes", async () => {
  const token = await me();
  for (const path of ["/", "/training", "/people", "/predictions"]) {
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
  for (const tab of ["people", "predictions", "training", "body"]) {
    const { status, body } = await call(`page ${tab}`, `/${tab}`, { token });
    expect(status).toBe(200);
    expect(body).not.toContain("#d9a441"); // greys, green and red only
    writeFileSync(join(artifacts, `page-${tab}.html`), standalone(body));
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
  await send(token, "/api/predictions", { decision: "Restart keeps data", confidence: 99 });
  await stopWorker();
  await startWorker();
  const after = await call("read after restart", "/api/predictions?q=Restart", { token });
  expect(after.body.rows).toHaveLength(1);
  expect((await call("schema survives too", "/api/_tabs/thoughts", { token })).status).toBe(200);
});

test("today is where you are, not in utc: a session minutes ago, in a place whose date isn't utc's, reads as today", async () => {
  // a place whose date differs from utc's right now: a day ahead (+14:00) in utc's afternoon, a day behind (-12:00) in its morning
  const hour = new Date().getUTCHours(), offset = hour >= 12 ? "+14:00" : "-12:00", minutes = hour >= 12 ? 14 * 60 : -12 * 60;
  const wall = new Date(Date.now() - 5 * 60_000 + minutes * 60_000).toISOString(), local = wall.slice(0, 10), clock = wall.slice(11, 16); // 5 minutes ago there
  expect(local).not.toBe(new Date().toISOString().slice(0, 10)); // the premise: utc's date is another day
  const agent = await instinct();
  const r = await send(agent, "/api/training", { at: `${local}T${clock}${offset}`, type: "strength", title: "midnight lift", lifts: "pull up: bwx5" });
  expect(r.status).toBe(201);
  try {
    const strip = (await call("strip, where you are", "/api/training/_views", { token: agent })).body.views.find((v: any) => v.kind === "strip");
    expect(strip).toMatchObject({ last: local, days_since_last: 0 });
    expect((await call("training page, where you are", "/training", { token: await me() })).body).toContain("last session today");
    // the list under it says so too: the row's date reads as today, and the live label counts from the same day
    await findHere();
    expect(here).toBe(minutes);
    expect((await call("api names, where you are", "/api", { token: agent })).body.tabs.find((t: any) => t.slug === "health").about).toBe(weeksLeft());
  } finally {
    await call("remove the midnight lift", `/api/training/${r.body.row.id}`, { method: "DELETE", token: agent });
  }
});
