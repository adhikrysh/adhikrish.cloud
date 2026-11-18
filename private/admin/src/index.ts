// admin.adhikrish.cloud
//   scheduled (every 5 minutes): probe every service and store up/down; drop rows older than 30 days once a day.
//   fetch: probe every service live for the current state, and read the stored history for the uptime strips.
import { external, privateSites, probe, publicSites, type Service } from "./probe.ts";
import { render, type Uptime } from "./page.ts";

type Env = { DB: D1Database; ACCESS_CLIENT_ID: string; ACCESS_CLIENT_SECRET: string };

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

export default {
  async scheduled(controller, env) {
    const results = await Promise.all(all.map((s: Service) => probe(s, token(env))));
    const insert = env.DB.prepare("INSERT INTO probes (service, at, up) VALUES (?, ?, ?)");
    const statements = results.map((r) => insert.bind(r.service, controller.scheduledTime, r.up ? 1 : 0));
    const t = new Date(controller.scheduledTime);
    if (t.getUTCHours() === 0 && t.getUTCMinutes() < 5) statements.push(env.DB.prepare("DELETE FROM probes WHERE at < ?").bind(controller.scheduledTime - KEEP));
    await env.DB.batch(statements);
  },

  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/") return new Response("not found", { status: 404 });
    const probeAll = (services: Service[]) => Promise.all(services.map((s) => probe(s, token(env))));
    const [pub, priv, history] = await Promise.all([probeAll(publicSites), probeAll(privateSites), uptime(env.DB, Date.now())]);
    return new Response(render([["public", publicSites, pub], ["private", privateSites, priv]], external, history), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  },
} satisfies ExportedHandler<Env>;
