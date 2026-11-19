// adhikrish.cloud: the public site. An assets-only worker: no code runs, cloudflare serves public/site as files.
// `cf deploy site` uploads the folder. site/_headers and site/_redirects keep working as they did on pages.
import { defineConfig } from "cf/config";

export default defineConfig({
  accountId: "463c6f3b7afadacdf235877e8e36a028",
  worker: {
    name: "adhikrish-cloud",
    compatibilityDate: "2026-11-01",
    assets: {
      // /txt serves txt.html, and /txt.html redirects to /txt, the same extensionless urls pages gave us.
      htmlHandling: "auto-trailing-slash",
      // A missing page gets 404.html with a real 404 status.
      notFoundHandling: "404-page",
    },
    domains: ["adhikrish.cloud", "www.adhikrish.cloud"],
    // Off: one public address only. Turn it on briefly to golden-test a change before it reaches the domain.
    workersDev: false,
    previewUrls: false,
    // No observability: requests that match a file are served without running a worker, so there is nothing to log.
  },
});
