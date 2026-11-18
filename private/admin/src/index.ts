// admin.adhikrish.cloud: on each request, probe every self-hosted service in parallel and render.
// No storage: the page shows the state right now. Cloudflare's tunnel health alert does the alerting.
import { external, probe, selfHosted } from "./probe.ts";
import { render } from "./page.ts";

type Env = { ACCESS_CLIENT_ID: string; ACCESS_CLIENT_SECRET: string };

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/") return new Response("not found", { status: 404 });
    const token = { id: env.ACCESS_CLIENT_ID, secret: env.ACCESS_CLIENT_SECRET };
    const results = await Promise.all(selfHosted.map((service) => probe(service, token)));
    return new Response(render(selfHosted, results, external), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  },
} satisfies ExportedHandler<Env>;
