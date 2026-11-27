// seniorintern.adhikrish.cloud: people, forecasts, training, books, health, for me and my personal agents.
// A worker with a d1 database: it keeps working when the thinkpad is off, and stays on the free plan.
import { bindings, defineConfig, triggers } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// --mode test (only the e2e test uses it) reads access signing keys from a local fake key server.
export default defineConfig(({ mode }) => ({
  accountId: "463c6f3b7afadacdf235877e8e36a028",
  worker: {
    name: "snrintern",
    entrypoint,
    compatibilityDate: "2026-11-01",
    // Only reachable through seniorintern.adhikrish.cloud, behind the seniorintern_app access application.
    domains: ["seniorintern.adhikrish.cloud"],
    // Hourly: garmin into the health tab (src/garmin.ts): recent days every 3rd hour, history while any is owed, under 50 requests a run.
    triggers: [triggers.scheduled({ schedule: "17 * * * *" })],
    // Run next to the d1 database, whose primary is in SJC (san jose; region WNAM), so each request's queries are short
    // trips. aws:us-west-1 is northern california. Placement only moves the default fetch handler, where every request lands.
    placement: { region: "aws:us-west-1" },
    workersDev: false,
    previewUrls: false,
    // Logs and traces in the dashboard (see private/admin/cloudflare.config.ts). Query strings are redacted:
    // ?q= carries search terms, which can be people's names.
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: true }, traces: { enabled: true } },
    env: {
      DB: bindings.d1({ name: "snrintern", id: "7d86a3be-7d4b-45c6-97b1-d9990ae1d484" }),
      ACCESS_TEAM: bindings.text("adhikrish"),
      // The seniorintern_app access application's audience tag (not a secret).
      ACCESS_AUD: bindings.text("e58f31f732ff5d00f7561ff36e3a9a23161176cdb806319370d50e6e2c0f387c"),
      // Service tokens allowed past /health, by client id (comma-separated). Access also lets the admin prober in,
      // but only for /health: it must never read the data. Production: dots, then instinct (each agent has its own token).
      AGENT_CLIENT_IDS: bindings.text(mode === "test" ? "dots-client-id,instinct-client-id" : "2fab0ff8670b9316e75907563e16eb75.access,008a5031cf05595c9ad91e5b42a10ffb.access"),
      ACCESS_CERTS_URL: mode === "test" && bindings.text(process.env.ACCESS_CERTS_URL ?? ""),
      // Garmin Personal API key (garmin connect web > settings > personal api key, 1 year; 1password: Personal > garmin personal api key).
      // The test talks to a fake garmin instead.
      GARMIN_API_KEY: mode === "test" ? bindings.text("test-garmin-key") : bindings.secret(),
      GARMIN_URL: mode === "test" && bindings.text(process.env.GARMIN_URL ?? ""),
      // Your birthday (yyyy-mm-dd) for the live tab labels (src/live.ts); 1password: Personal > snrintern birthday. Never in git:
      // the repo is public. The test uses a made-up one.
      BIRTHDAY: mode === "test" ? bindings.text("1990-01-01") : bindings.secret(),
    },
  },
}));
