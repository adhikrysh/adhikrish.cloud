// End to end: apply the d1 migrations with cf, run the worker in workerd, import the sheet exports,
// call it the way dots and a browser do (with cloudflare-access-style signed jwts), restart it,
// and check nothing was lost.
// Writes test/artifacts/e2e-report.json and the rendered pages, so a run can be inspected afterwards.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { importRows, sheetToRows } from "../scripts/import.ts";

const root = join(import.meta.dir, "..");
const artifacts = join(import.meta.dir, "artifacts");
const state = mkdtempSync(join(tmpdir(), "snrintern-d1-"));
const DB_ID = "7d86a3be-7d4b-45c6-97b1-d9990ae1d484";
const TEAM = "adhikrish";
const AUD = "e58f31f732ff5d00f7561ff36e3a9a23161176cdb806319370d50e6e2c0f387c"; // the real app's tag, as configured
const report: { scenario: string; status: number; detail?: unknown }[] = [];

let jwks: ReturnType<typeof Bun.serve>;
let worker: ReturnType<typeof Bun.spawn> | undefined;
let port = 0;
let sign: (claims: Record<string, unknown>, opts?: { aud?: string; forged?: boolean }) => Promise<string>;

const cf = (...args: string[]) => {
  const run = Bun.spawnSync(["npx", "cf", ...args, "--local", "--persist-to", state], { cwd: root });
  if (run.exitCode !== 0) throw new Error(run.stdout.toString() + run.stderr.toString());
};

// The worker runs in workerd, cloudflare's real runtime, through the vite dev server, on local d1.
async function startWorker() {
  port = 20000 + Math.floor(Math.random() * 20000);
  worker = Bun.spawn(["npx", "vite", "dev", "--mode", "test", "--port", String(port), "--strictPort"], {
    cwd: root,
    env: { ...process.env, SNRINTERN_STATE: state, ACCESS_CERTS_URL: `http://127.0.0.1:${jwks.port}/cdn-cgi/access/certs` },
    stdout: "pipe", stderr: "pipe",
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://localhost:${port}/health`)).ok) return; } catch {}
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

beforeAll(async () => {
  // A stand-in for cloudflare access: it signs jwts and publishes the public key the way access does.
  const real = await generateKeyPair("RS256");
  const forger = await generateKeyPair("RS256");
  const publicJwk = { ...(await exportJWK(real.publicKey)), kid: "test-key", alg: "RS256" };
  jwks = Bun.serve({ port: 0, fetch: () => Response.json({ keys: [publicJwk] }) });
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(`https://${TEAM}.cloudflareaccess.com`)
      .setAudience(opts.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(opts.forged ? forger.privateKey : real.privateKey);

  // Same path as production: cf applies the migrations, then the import script posts every csv row to the api.
  cf("d1", "migrations", "apply", DB_ID);
  await startWorker();
  const importer = { "cf-access-jwt-assertion": await sign({ email: "importer@example.com" }) };
  for (const [tab, file] of [["people", "ppl-index.csv"], ["outbound", "cold-outbounds.csv"], ["forecasts", "superforecasting.csv"], ["gym", "gym-sessions.tsv"]]) {
    const rows = sheetToRows(tab, await Bun.file(join(import.meta.dir, "fixtures", file)).text());
    await importRows(`http://localhost:${port}`, importer, tab, rows);
  }
}, 120_000);

afterAll(async () => {
  await stopWorker();
  jwks.stop();
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "e2e-report.json"), JSON.stringify({ ranAt: new Date().toISOString(), calls: report }, null, 2));
  rmSync(state, { recursive: true, force: true });
});

const me = () => sign({ email: "me@example.com" });
const dots = () => sign({ common_name: "dots-client-id" });
const post = (token: string, path: string, body: unknown, method = "POST") =>
  call(`${method} ${path}`, path, { method, token, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("the import renamed and normalized every sheet column", async () => {
  const token = await me();
  const { body } = await call("list tabs", "/api", { token });
  expect(Object.fromEntries(body.tabs.map((t: any) => [t.slug, t.rows]))).toEqual({ people: 3, outbound: 2, forecasts: 2, gym: 3 });
  const people = (await call("people", "/api/people", { token })).body.rows;
  const ada = people.find((r: any) => r.name === "Ada Example");
  expect(ada.met_date).toBe("2026-06-25"); // 250626 is day, month, year
  expect(people.find((r: any) => r.name === "Ben Sample").met_date).toBe("2025-06-19");
  expect(people.find((r: any) => r.name === "Cy Placeholder").met_date).toBeUndefined(); // "Call / intro" is not a date
  const outbound = (await call("outbound", "/api/outbound", { token })).body.rows;
  const first = outbound.find((r: any) => r.name === "exampleworkspace.io");
  expect(first).toMatchObject({ reply: "no reply", message: "Hey, I'm building a proof of concept\nand would love 15 minutes." });
  expect(first.follow_ups).toStartWith("#1 -- 25 days --");
  expect(outbound.find((r: any) => r.name === "Dee Fixture").context).toBe("founder");
  const forecasts = (await call("forecasts", "/api/forecasts", { token })).body.rows;
  expect(forecasts.map((r: any) => [r.date, r.confidence, r.verdict ?? null, r.status])).toEqual([
    ["2026-06-30", 80, "right", "closed"], ["2026-06-26", 80, null, "open"], // sorted by date, newest first
  ]);
  const gym = (await call("gym", "/api/gym", { token })).body.rows;
  expect(gym.map((r: any) => r.at)).toEqual(["2026-08-24", "2026-07-18T01:34-07:00", "2026-07-07T17:25"]);
  expect(gym[2]).toMatchObject({ notes: "First ever leg day", duration_min: 60, rpe: 8, updated_by: "importer@example.com" });
});

test("requests that did not come through access are refused", async () => {
  expect((await call("no jwt", "/api")).status).toBe(401);
  expect((await call("jwt for another app", "/api", { token: await sign({ email: "me@example.com" }, { aud: "other-app" }) })).status).toBe(401);
  expect((await call("jwt signed by the wrong key", "/api", { token: await sign({ email: "me@example.com" }, { forged: true }) })).status).toBe(401);
  expect((await call("health needs no jwt", "/health")).status).toBe(200);
  expect((await call("a service token that is not the agent (the admin prober)", "/api", { token: await sign({ common_name: "admin-prober-id" }) })).status).toBe(403);
});

test("dots adds, edits, finds and deletes rows", async () => {
  const token = await dots();
  const added = await post(token, "/api/gym", { at: "2026-11-17T18:00-08:00", type: "strength", title: "Back day", duration_min: "62", rpe: 7 });
  expect(added.status).toBe(201);
  expect(added.body.row).toMatchObject({ title: "Back day", duration_min: 62, rpe: 7, updated_by: "service:dots-client-id" });
  const id = added.body.row.id;
  const edited = await post(token, `/api/gym/${id}`, { rpe: 8, notes: "felt strong", summary: null }, "PATCH");
  expect(edited.body.row).toMatchObject({ rpe: 8, notes: "felt strong", title: "Back day" });
  expect(edited.body.row.summary).toBeUndefined();
  expect((await call("dots searches every value", "/api/people?q=robots", { token })).body.rows.map((r: any) => r.name)).toEqual(["Ben Sample"]);
  expect((await call("search does not match field names", "/api/people?q=met_where", { token })).body.rows).toEqual([]);
  expect((await call("dots deletes a row", `/api/gym/${id}`, { method: "DELETE", token })).status).toBe(200);
  expect((await call("deleted row is gone", `/api/gym/${id}`, { token })).status).toBe(404);
});

test("bad writes get a message that says how to fix them", async () => {
  const token = await dots();
  const cases: [string, unknown, string][] = [
    ["/api/gym", { at: "2026-11-17", weight: 80 }, 'unknown field "weight". fields: at, type, title'],
    ["/api/people", { company: "Nowhere" }, '"name" is required'],
    ["/api/gym", { at: "2026-11-17", rpe: "hard" }, '"rpe" must be a whole number'],
    ["/api/gym", { at: "2026-11-17", rpe: 11 }, '"rpe" must be at most 10'],
    ["/api/gym", { at: "yesterday" }, '"at" must be a date or iso date-time'],
    ["/api/gym", { at: "2026-11-17", type: "yoga" }, '"type" must be one of: strength, cardio, other'],
    ["/api/people", { name: "X", linkedin: "linkedin.com/in/x" }, '"linkedin" must be a url'],
    ["/api/forecasts", { decision: "Y", review_date: "2026-13-40" }, '"review_date" must be a date like'],
  ];
  for (const [path, body, message] of cases) {
    const r = await post(token, path, body);
    expect(r.status).toBe(400);
    expect(r.body.error).toStartWith(message);
  }
  expect((await call("unknown tab", "/api/thoughts", { token })).body.error).toContain("tabs: people, outbound, forecasts, gym");
});

test("tabs and columns are added through the api, with no migration, and every change is logged", async () => {
  const token = await dots();
  const gym = (await call("read gym schema", "/api/_tabs/gym", { token })).body.tab;
  const { slug: _s, position: _p, ...definition } = gym;
  const withColumn = { ...definition, fields: [...definition.fields, { name: "place", type: "text" }] };
  expect((await post(token, "/api/_tabs/gym", withColumn, "PUT")).status).toBe(200);
  const row = await post(token, "/api/gym", { at: "2026-11-18", title: "Legs", place: "home gym" });
  expect(row.body.row.place).toBe("home gym");
  const oldRow = (await call("old rows lack the new column", "/api/gym?q=First%20leg", { token })).body.rows[0];
  expect(oldRow.place).toBeUndefined();

  const thoughts = { label: "thoughts", about: "things worth remembering", title: "text", sort: "at",
    fields: [{ name: "text", type: "text", required: true }, { name: "at", type: "datetime" }, { name: "source", type: "url" }] };
  expect((await post(token, "/api/_tabs/thoughts", thoughts, "PUT")).status).toBe(201);
  expect((await post(token, "/api/thoughts", { text: "the schema is data now", at: "2026-11-18" })).status).toBe(201);
  const home = await call("home shows the new tab", "/", { token: await me() });
  expect(home.body).toContain('href="/thoughts"');

  expect((await post(token, "/api/_tabs/thoughts", {}, "DELETE")).status).toBe(409); // still has a row
  const bad: [unknown, string][] = [
    [{ ...thoughts, fields: [{ name: "id", type: "text" }] }, 'field name "id" is reserved'],
    [{ ...thoughts, fields: [{ name: "mood", type: "enum" }] }, 'field "mood": enum fields need "options"'],
    [{ ...thoughts, title: "nope" }, '"title" must name one of the fields'],
    [{ ...thoughts, fields: [{ name: "Bad Name", type: "text" }] }, "fields[0].name must be lowercase snake_case"],
  ];
  for (const [definition, message] of bad) expect((await post(token, "/api/_tabs/scratch", definition, "PUT")).body.error).toStartWith(message);
  expect((await post(token, "/api/_tabs/scratch", { label: "scratch", about: "", fields: [{ name: "x", type: "text" }] }, "PUT")).status).toBe(201);
  expect((await call("delete an empty tab", "/api/_tabs/scratch", { method: "DELETE", token })).status).toBe(200);

  const log = (await call("schema log", "/api/_log", { token })).body.changes;
  expect(log.slice(0, 4).map((c: any) => [c.tab, c.before === null ? "created" : c.after === null ? "deleted" : "changed", c.by])).toEqual([
    ["scratch", "deleted", "service:dots-client-id"], ["scratch", "created", "service:dots-client-id"],
    ["thoughts", "created", "service:dots-client-id"], ["gym", "changed", "service:dots-client-id"],
  ]);
  expect(log[3].after.fields.at(-1)).toEqual({ name: "place", type: "text" });
});

test("the pages render each tab and a row", async () => {
  const token = await me();
  mkdirSync(artifacts, { recursive: true });
  const home = await call("home lists every tab", "/", { token });
  expect(home.status).toBe(200);
  for (const tab of ["people", "outbound", "forecasts", "gym"]) expect(home.body).toContain(`href="/${tab}"`);
  expect(home.body).toContain('href="https://admin.adhikrish.cloud/"');
  expect(home.body).not.toContain('<a href="/">snrintern</a>'); // no link to the page you're on
  writeFileSync(join(artifacts, "page-home.html"), home.body);
  for (const tab of ["people", "outbound", "forecasts", "gym"]) {
    const { status, body } = await call(`page ${tab}`, `/${tab}`, { token });
    expect(status).toBe(200);
    expect(body).toContain('<ul class="project-list">');
    writeFileSync(join(artifacts, `page-${tab}.html`), body);
  }
  expect((await call("search narrows a tab", "/people?q=robots", { token })).body).toContain("1 matching");
  const people = (await call("people rows", "/api/people", { token })).body.rows;
  const ada = people.find((r: any) => r.name === "Ada Example");
  const row = await call("row page", `/people/${ada.id}`, { token });
  expect(row.body).toContain('<a href="https://www.linkedin.com/in/ada-example/" target="_blank"');
  expect(row.body).not.toContain("<dt>name</dt>"); // the title is not repeated
  writeFileSync(join(artifacts, "page-people-row.html"), row.body);
});

test("a restart loses nothing", { timeout: 60_000 }, async () => {
  const token = await me();
  await post(token, "/api/forecasts", { decision: "Restart keeps data", confidence: 99 });
  await stopWorker();
  await startWorker();
  const after = await call("read after restart", "/api/forecasts?q=Restart", { token });
  expect(after.body.rows).toHaveLength(1);
  expect(after.body.rows[0].updated_by).toBe("me@example.com");
  expect((await call("schema survives too", "/api/_tabs/thoughts", { token })).status).toBe(200);
});
