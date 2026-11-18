// snrintern.adhikrish.cloud
//   /health          liveness for the admin dashboard
//   /api/...         json api (src/api.ts): dots and scripts
//   /, /<tab>, /<tab>/<id>, /<tab>/lifts/<exercise>  read-only pages (src/page.ts). all writes go through the api.
// Every request except /health must carry the jwt cloudflare access signs for requests it let in.
import base from "../../../design/base.css?raw";
import list from "../../../design/list.css?raw";
import { handleApi } from "./api.ts";
import { verifier } from "./auth.ts";
import * as db from "./db.ts";
import { exercisePage, homePage, rowPage, tabPage } from "./page.ts";

type Env = { DB: D1Database; ACCESS_TEAM: string; ACCESS_AUD: string; AGENT_CLIENT_IDS: string; ACCESS_CERTS_URL?: string };

const design = { base, list };
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
let caller: ReturnType<typeof verifier> | undefined; // one key cache per isolate

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");

    caller ??= verifier({ team: env.ACCESS_TEAM, aud: env.ACCESS_AUD, certsUrl: env.ACCESS_CERTS_URL });
    const who = await caller(request);
    if (!who) return Response.json({ error: "not signed by cloudflare access" }, { status: 401 });
    // People (an email) get everything. A service token gets in only if it is a listed agent.
    if (who.who.startsWith("service:") && !env.AGENT_CLIENT_IDS.split(",").includes(who.who.slice("service:".length))) {
      return Response.json({ error: "this service token may only call /health" }, { status: 403 });
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return handleApi(request, env.DB, who.who);
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });

    const [, slug, id, name] = url.pathname.split("/");
    if (!slug) return html(await homePage(design, env.DB));
    const tab = await db.tab(env.DB, slug);
    if (!tab) return html("not found", 404);
    if (!id) return html(await tabPage(design, env.DB, tab, url.searchParams.get("q") ?? ""));
    if (id === "lifts" && name) {
      const lift = await exercisePage(design, env.DB, tab, decodeURIComponent(name));
      return lift ? html(lift) : html("not found", 404);
    }
    const row = await db.get(env.DB, tab.slug, Number(id));
    return row ? html(await rowPage(design, env.DB, tab, row)) : html("not found", 404);
  },
} satisfies ExportedHandler<Env>;
