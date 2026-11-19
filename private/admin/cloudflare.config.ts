// uptime.adhikrish.cloud: the public service dashboard. A timer probes every service every 5 minutes and stores
// the results in d1; a page load only reads them, so visitors never cause probes. It runs on cloudflare, not on the thinkpad,
// so it can still say the thinkpad is down. Alerting is cloudflare's "tunnel health alert" email.
import { bindings, defineConfig, triggers } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  accountId: "463c6f3b7afadacdf235877e8e36a028",
  worker: {
    name: "admin",
    entrypoint,
    compatibilityDate: "2026-11-01",
    // Public: a bypass access app lets everyone in. The prober token is a worker secret and never reaches a browser.
    // workers.dev and preview urls stay off so the hostname is the only way in.
    domains: ["uptime.adhikrish.cloud"],
    workersDev: false,
    previewUrls: false,
    // Logs (one event per request or cron run, plus any console output) and traces (a timed tree of each run's
    // fetches and d1 queries) in the dashboard. Free plan: a shared 0.5 GB/day; past it cloudflare stops ingesting
    // until 00:00 utc, it never bills.
    observability: { enabled: true, logs: { enabled: true, invocationLogs: true }, traces: { enabled: true } },
    // Probe from near the thinkpad, which is in singapore. Placement only moves the fetch handler, so the timer
    // hands its work to this worker's own fetch handler through SELF (see src/index.ts).
    placement: { region: "aws:ap-southeast-1" },
    triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
    env: {
      // This worker, bound to itself, so the timer can hand its run to the placed fetch handler (see src/index.ts).
      SELF: bindings.worker({ worker: "admin" }),
      // Senior intern's Health entrypoint: a named export with no url, so only this binding can call it.
      SENIORINTERN: bindings.worker({ worker: "snrintern", exportName: "Health" }),
      DB: bindings.d1({ name: "admin-uptime", id: "4ec47cb9-170e-4c74-a5f0-ddece6429df7" }),
      // An access service token, so probes get through access to each service.
      ACCESS_CLIENT_ID: bindings.secret(),
      ACCESS_CLIENT_SECRET: bindings.secret(),
    },
  },
});
