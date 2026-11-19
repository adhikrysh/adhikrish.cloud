// uptime.adhikrish.cloud: the service dashboard. Each page load probes every service live; a timer probes
// every 5 minutes and stores up/down in d1 for the uptime strips. It runs on cloudflare, not on the thinkpad,
// so it can still say the thinkpad is down. Alerting is cloudflare's "tunnel health alert" email.
import { bindings, defineConfig, triggers } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  accountId: "463c6f3b7afadacdf235877e8e36a028",
  worker: {
    name: "admin",
    entrypoint,
    compatibilityDate: "2026-11-01",
    // Only reachable through uptime.adhikrish.cloud, which cloudflare access guards.
    // workers.dev and preview urls would skip access, so both stay off.
    domains: ["uptime.adhikrish.cloud"],
    workersDev: false,
    previewUrls: false,
    // Logs (one event per request or cron run, plus any console output) and traces (a timed tree of each run's
    // fetches and d1 queries) in the dashboard. Free plan: a shared 0.5 GB/day; past it cloudflare stops ingesting
    // until 00:00 utc, it never bills.
    observability: { enabled: true, logs: { enabled: true, invocationLogs: true }, traces: { enabled: true } },
    triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
    env: {
      DB: bindings.d1({ name: "admin-uptime", id: "4ec47cb9-170e-4c74-a5f0-ddece6429df7" }),
      // An access service token, so probes get through access to each service.
      ACCESS_CLIENT_ID: bindings.secret(),
      ACCESS_CLIENT_SECRET: bindings.secret(),
    },
  },
});
