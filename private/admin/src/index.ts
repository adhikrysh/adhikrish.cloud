// uptime.adhikrish.cloud
//   scheduled (every 5 minutes): ask this worker's own fetch handler, through SELF, to probe. Placement pins the fetch
//     handler near singapore but never moves the timer, so the probing happens there, not wherever the timer ran.
//   fetch /_probe (only through SELF): probe every service and store the result; drop rows older than 30 days once a day.
//   fetch: read only what the timer stored. A visit never probes, so reloading the page can't push traffic
//   through the tunnel to the thinkpad, and the page is at most 5 minutes old.
import { privateSites, probe, publicSites, type ProbeResult, type Service } from "./probe.ts";
import { render, type Uptime } from "./page.ts";

type Env = { DB: D1Database; SELF: Fetcher; SENIORINTERN: Fetcher; ACCESS_CLIENT_ID: string; ACCESS_CLIENT_SECRET: string };

const HOUR = 3_600_000;
const KEEP = 30 * 24 * HOUR;
const all = [...publicSites, ...privateSites];
const token = (env: Env) => ({ id: env.ACCESS_CLIENT_ID, secret: env.ACCESS_CLIENT_SECRET });

/** Per service: the last 24 hours as hourly ticks (true = every probe up, false = any down, null = no data) and 30-day uptime. */
async function uptime(db: D1Database, now: number): Promise<Map<string, Uptime>> {
  const start = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
  const [hours, month] = await Promise.all([
    db.prepare("SELECT service, (at / 3600000) * 3600000 AS hour, MIN(up) AS up FROM probes WHERE at >= ? GROUP BY service, hour").bind(start).all<{ service: string; hour: number; up: number }>(),
    db.prepare("SELECT service, AVG(up) AS ratio FROM probes WHERE at >= ? GROUP BY service").bind(now - KEEP).all<{ service: string; ratio: number }>(),
  ]);
  const out = new Map<string, Uptime>();
  for (const s of all) out.set(s.name, { ticks: Array.from({ length: 24 }, () => null), ratio: null });
  for (const h of hours.results) {
    const i = Math.round((h.hour - start) / HOUR);
    const u = out.get(h.service);
    if (u && i >= 0 && i < 24) u.ticks[i] = h.up === 1;
  }
  for (const m of month.results) { const u = out.get(m.service); if (u) u.ratio = m.ratio; }
  return out;
}

/** The newest stored probe of each service, or a placeholder until the first timer run. */
async function latest(db: D1Database): Promise<Map<string, ProbeResult>> {
  const rows = await db.prepare(
    "SELECT service, at, up, status, ms, error FROM probes p WHERE at = (SELECT MAX(at) FROM probes WHERE service = p.service)",
  ).all<{ service: string; at: number; up: number; status: number | null; ms: number | null; error: string | null }>();
  const out = new Map<string, ProbeResult>();
  for (const r of rows.results) out.set(r.service, { ...r, up: r.up === 1 });
  return out;
}
const waiting = (service: string): ProbeResult => ({ service, at: 0, up: false, status: null, ms: null, error: "no probe yet" });

/** Probe every service in parallel and store one row each; once a day also drop rows past 30 days. */
async function probeAll(env: Env, at: number): Promise<void> {
  const results = await Promise.all(all.map((s: Service) => probe(s, token(env), { SENIORINTERN: env.SENIORINTERN })));
  const insert = env.DB.prepare("INSERT INTO probes (service, at, up, status, ms, error) VALUES (?, ?, ?, ?, ?, ?)");
  const statements = results.map((r) => insert.bind(r.service, at, r.up ? 1 : 0, r.status, r.ms, r.error));
  const t = new Date(at);
  if (t.getUTCHours() === 0 && t.getUTCMinutes() < 5) statements.push(env.DB.prepare("DELETE FROM probes WHERE at < ?").bind(at - KEEP));
  await env.DB.batch(statements);
}

export default {
  async scheduled(controller, env) {
    const response = await env.SELF.fetch(`https://self/_probe?at=${controller.scheduledTime}`);
    console.log(`probe run: ${response.status} ${await response.text()}`);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/_probe") {
      // props exist only on calls through the SELF binding; a request from the internet has none.
      if (!(ctx.props as { probe?: boolean } | undefined)?.probe) return new Response("not found", { status: 404 });
      await probeAll(env, Number(url.searchParams.get("at")) || Date.now());
      return new Response(`probed from ${(request.cf as { colo?: string } | undefined)?.colo ?? "unknown"}`);
    }
    if (url.pathname !== "/") return new Response("not found", { status: 404 });
    const [now, history] = await Promise.all([latest(env.DB), uptime(env.DB, Date.now())]);
    const results = (services: Service[]) => services.map((s) => now.get(s.name) ?? waiting(s.name));
    const [pub, priv] = [results(publicSites), results(privateSites)];
    return new Response(render([["public", publicSites, pub], ["private/self-hosted", privateSites, priv]], history), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  },
} satisfies ExportedHandler<Env>;
