// End to end: apply the d1 migrations and import the sheet csvs with cf, run the worker in workerd,
// call it the way dots and a browser do (with cloudflare-access-style signed jwts), restart it,
// and check nothing was lost.
// Writes test/artifacts/e2e-report.json and the rendered pages, so a run can be inspected afterwards.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { importCsv } from "../scripts/import.ts";

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
  for (const [tab, file] of [["people", "ppl-index"], ["outbound", "cold-outbounds"], ["forecasts", "superforecasting"], ["gym", "gym-sessions"]]) {
    await importCsv(`http://localhost:${port}`, importer, tab, await Bun.file(join(import.meta.dir, "fixtures", `${file}.csv`)).text());
  }
}, 120_000);

afterAll(async () => {
  await stopWorker();
  jwks.stop();
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "e2e-report.json"), JSON.stringify({ ranAt: new Date().toISOString(), calls: report }, null, 2));
  rmSync(state, { recursive: true, force: true });
});

test("the csv import kept every row, including multi-line cells", async () => {
  const me = await sign({ email: "me@example.com" });
  const { status, body } = await call("list tabs", "/api", { token: me });
  expect(status).toBe(200);
  expect(Object.fromEntries(body.tabs.map((t: any) => [t.slug, t.rows]))).toEqual({ people: 3, outbound: 2, forecasts: 2, gym: 3 });
  const outbound = await call("outbound rows", "/api/outbound", { token: me });
  const first = outbound.body.rows.find((r: any) => r.name === "exampleworkspace.io");
  expect(first.message).toBe("Hey, I'm building a proof of concept\nand would love 15 minutes.");
  expect(first.follow_up).toStartWith("#1 -- 25 days --");
  expect(first.updated_by).toBe("importer@example.com");
});

test("requests that did not come through access are refused", async () => {
  expect((await call("no jwt", "/api")).status).toBe(401);
  expect((await call("jwt for another app", "/api", { token: await sign({ email: "me@example.com" }, { aud: "other-app" }) })).status).toBe(401);
  expect((await call("jwt signed by the wrong key", "/api", { token: await sign({ email: "me@example.com" }, { forged: true }) })).status).toBe(401);
  expect((await call("health needs no jwt", "/health")).status).toBe(200);
  expect((await call("a service token that is not the agent (the admin prober)", "/api", { token: await sign({ common_name: "admin-prober-id" }) })).status).toBe(403);
});

test("dots adds, edits, finds and deletes rows with its service token", async () => {
  const dots = await sign({ common_name: "dots-client-id" });
  const added = await call("dots logs a gym session", "/api/gym", {
    method: "POST", token: dots, body: JSON.stringify({ date: "2026-11-17", type: "strength", title: "Back day", duration_min: "62", rpe: 7 }),
  });
  expect(added.status).toBe(201);
  expect(added.body.row).toMatchObject({ title: "Back day", duration_min: 62, rpe: 7, updated_by: "service:dots-client-id" });

  const reply = await call("dots marks an outbound reply", "/api/outbound/1", { method: "PATCH", token: dots, body: JSON.stringify({ replied: "yes", status: "replied" }) });
  expect(reply.status).toBe(200);
  expect(reply.body.row).toMatchObject({ replied: "yes", status: "replied", updated_by: "service:dots-client-id" });
  expect(reply.body.row.message).toContain("proof of concept"); // untouched fields stay

  const found = await call("dots searches people", "/api/people?q=robots", { token: dots });
  expect(found.body.rows.map((r: any) => r.name)).toEqual(["Ben Sample"]);

  const gone = await call("dots deletes a row", `/api/gym/${added.body.row.id}`, { method: "DELETE", token: dots });
  expect(gone.status).toBe(200);
  expect((await call("deleted row is gone", `/api/gym/${added.body.row.id}`, { token: dots })).status).toBe(404);
});

test("bad writes get a message that says how to fix them", async () => {
  const dots = await sign({ common_name: "dots-client-id" });
  const unknown = await call("unknown field", "/api/gym", { method: "POST", token: dots, body: JSON.stringify({ date: "2026-11-17", weight: 80 }) });
  expect(unknown.status).toBe(400);
  expect(unknown.body.error).toContain("fields: date, type, title");
  const missing = await call("missing required field", "/api/people", { method: "POST", token: dots, body: JSON.stringify({ company: "Nowhere" }) });
  expect(missing.body.error).toBe('"name" is required');
  const notNumber = await call("rpe is not a number", "/api/gym", { method: "POST", token: dots, body: JSON.stringify({ date: "2026-11-17", rpe: "hard" }) });
  expect(notNumber.body.error).toBe('"rpe" must be a whole number');
  expect((await call("unknown tab", "/api/thoughts", { token: dots })).status).toBe(404);
});

test("the pages render each tab and a row", async () => {
  const me = await sign({ email: "me@example.com" });
  mkdirSync(artifacts, { recursive: true });
  for (const tab of ["people", "outbound", "forecasts", "gym"]) {
    const { status, body } = await call(`page ${tab}`, `/${tab}`, { token: me });
    expect(status).toBe(200);
    expect(body).toContain('<ul class="project-list">');
    writeFileSync(join(artifacts, `page-${tab}.html`), body);
  }
  const row = await call("row page", "/outbound/1", { token: me });
  expect(row.body).toContain("<dt>follow up</dt>");
  expect(row.body).not.toContain("<dt>name</dt>"); // the title is not repeated
  expect(row.body).toContain("by service:dots-client-id");
  writeFileSync(join(artifacts, "page-outbound-1.html"), row.body);
  const home = await call("home lists every tab", "/", { token: me });
  expect(home.status).toBe(200);
  for (const tab of ["people", "outbound", "forecasts", "gym"]) expect(home.body).toContain(`href="/${tab}"`);
  expect(home.body).toContain("3 rows");
  expect(home.body).toContain('href="https://admin.adhikrish.cloud/"');
  writeFileSync(join(artifacts, "page-home.html"), home.body);
  const search = await call("search narrows a tab", "/people?q=robots", { token: me });
  expect(search.body).toContain("1 matching");
});

test("a restart loses nothing", { timeout: 60_000 }, async () => {
  const me = await sign({ email: "me@example.com" });
  await call("write before restart", "/api/forecasts", { method: "POST", token: me, body: JSON.stringify({ decision: "Restart keeps data", confidence: "99%" }) });
  await stopWorker();
  await startWorker();
  const after = await call("read after restart", "/api/forecasts?q=Restart", { token: me });
  expect(after.body.rows).toHaveLength(1);
  expect(after.body.rows[0].updated_by).toBe("me@example.com");
});
