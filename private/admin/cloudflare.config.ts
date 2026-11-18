// admin.adhikrish.cloud: the service dashboard. Each page load probes every service live.
// It runs on cloudflare, not on the thinkpad, so it can still say the thinkpad is down.
// Alerting is not here: cloudflare's "tunnel health alert" notification emails when the tunnel drops.
import { bindings, defineConfig } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  accountId: "463c6f3b7afadacdf235877e8e36a028",
  worker: {
    name: "admin",
    entrypoint,
    compatibilityDate: "2026-11-01",
    // Only reachable through admin.adhikrish.cloud, which cloudflare access guards.
    // workers.dev and preview urls would skip access, so both stay off.
    domains: ["admin.adhikrish.cloud"],
    workersDev: false,
    previewUrls: false,
    env: {
      // An access service token, so probes get through access to each service.
      ACCESS_CLIENT_ID: bindings.secret(),
      ACCESS_CLIENT_SECRET: bindings.secret(),
    },
  },
});
