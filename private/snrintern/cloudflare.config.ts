// snrintern.adhikrish.cloud: people, outbound, forecasts and gym, for me and my personal agent.
// A worker with a d1 database: it keeps working when the thinkpad is off, and stays on the free plan.
import { bindings, defineConfig } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// --mode test (only the e2e test uses it) reads access signing keys from a local fake key server.
export default defineConfig(({ mode }) => ({
  accountId: "463c6f3b7afadacdf235877e8e36a028",
  worker: {
    name: "snrintern",
    entrypoint,
    compatibilityDate: "2026-11-01",
    // Only reachable through snrintern.adhikrish.cloud, behind the snrintern_app access application.
    domains: ["snrintern.adhikrish.cloud"],
    workersDev: false,
    previewUrls: false,
    env: {
      DB: bindings.d1({ name: "snrintern", id: "7d86a3be-7d4b-45c6-97b1-d9990ae1d484" }),
      ACCESS_TEAM: bindings.text("adhikrish"),
      // The snrintern_app access application's audience tag (not a secret).
      ACCESS_AUD: bindings.text("e58f31f732ff5d00f7561ff36e3a9a23161176cdb806319370d50e6e2c0f387c"),
      // Service tokens allowed past /health, by client id (comma-separated). Access also lets the admin prober in,
      // but only for /health: it must never read the data. The production value is dots' client id.
      AGENT_CLIENT_IDS: bindings.text(mode === "test" ? "dots-client-id" : "2fab0ff8670b9316e75907563e16eb75.access"),
      ACCESS_CERTS_URL: mode === "test" && bindings.text(process.env.ACCESS_CERTS_URL ?? ""),
    },
  },
}));
