// seniorintern.adhikrish.cloud
//   /_health         readiness for the uptime page (underscored like every system path, so no tab slug can shadow it)
//   /api/...         json api (src/api.ts): dots and scripts
//   /, /<tab>, /<tab>/<id>, /<tab>/lifts/<exercise>, /<tab>/metrics/<field>  read-only pages (src/page.ts). all writes go through the api,
//   except the hourly garmin sync (src/garmin.ts), which writes the health, training and body tabs directly.
// Every request except /_health must carry the jwt cloudflare access signs for requests it let in.
import base from "../../../design/base.css?raw";
import list from "../../../design/list.css?raw";
import { handleApi } from "./api.ts";
import { todayHere } from "./here.ts";
import { verifier } from "./auth.ts";
import * as db from "./db.ts";
import { CHARTS_PATH, chartsAsset } from "./charts.ts";
import { GRAPH_PATH, graphAsset } from "./graph.ts";
import { sync } from "./garmin.ts";
import { exercisePage, homePage, metricHistoryPage, rowPage, tabPage } from "./page.ts";

type Env = { DB: D1Database; ACCESS_TEAM: string; ACCESS_AUD: string; AGENT_CLIENT_IDS: string; ACCESS_CERTS_URL?: string; GARMIN_API_KEY?: string; GARMIN_URL?: string; BIRTHDAY?: string };

const design = { base, list };
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
let caller: ReturnType<typeof verifier> | undefined; // one key cache per isolate

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Readiness for the uptime worker, which calls it over a service binding: a trivial query, so uptime turns red when
    // the database is unreachable, not only when the worker is. No jwt needed: from the internet, access still stands in
    // front of it (only you and the agent get through), and all it can do is answer "1".
    // It reports how long its own query took, so uptime shows the database's speed for senior intern.
    if (url.pathname === "/_health") {
      const start = Date.now();
      try {
        await env.DB.prepare("SELECT 1").first();
        return Response.json({ ok: true, ms: Date.now() - start });
      } catch {
        return Response.json({ ok: false, ms: Date.now() - start }, { status: 503 });
      }
    }

    caller ??= verifier({ team: env.ACCESS_TEAM, aud: env.ACCESS_AUD, certsUrl: env.ACCESS_CERTS_URL });
    const who = await caller(request);
    if (!who) return Response.json({ error: "not signed by cloudflare access" }, { status: 401 });
    // People (an email) get everything. A service token gets in only if it is a listed agent.
    if (who.who.startsWith("service:") && !env.AGENT_CLIENT_IDS.split(",").includes(who.who.slice("service:".length))) {
      return Response.json({ error: "this service token may only call /_health" }, { status: 403 });
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return handleApi(request, env.DB, who.who, env.BIRTHDAY);
    if (url.pathname === CHARTS_PATH) return chartsAsset(); // the chart library, cached forever (its version is in the path)
    if (url.pathname === GRAPH_PATH) return graphAsset(); // the graph library, the same way
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });

    const [, slug, id, name] = url.pathname.split("/");
    if (!slug) return html(await homePage(design, env.DB, env.BIRTHDAY));
    const tab = await db.tab(env.DB, slug);
    if (!tab) return html("not found", 404);
    if (!id) return html(await tabPage(design, env.DB, tab, url.searchParams.get("q") ?? "", Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1)));
    if (id === "metrics" && name) {
      const metric = await metricHistoryPage(design, env.DB, tab, decodeURIComponent(name));
      return metric ? html(metric) : html("not found", 404);
    }
    if (id === "lifts" && name) {
      const lift = await exercisePage(design, env.DB, tab, decodeURIComponent(name));
      return lift ? html(lift) : html("not found", 404);
    }
    const row = await db.get(env.DB, tab.slug, Number(id));
    if (!row) return html("not found", 404);
    const [series, today] = await Promise.all([db.getSeries(env.DB, row.id), todayHere(env.DB)]);
    return html(rowPage(design, tab, row, series, today));
  },

  // hourly: garmin's recent days, one month further back, and owed intraday detail (src/garmin.ts)
  async scheduled(controller, env) {
    await sync(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
