import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The worker imports ../../services.json and ../../design/*, so the dev server may read the repo root.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// The e2e test points local d1 state at a fresh directory with SNRINTERN_STATE.
export default defineConfig({
  plugins: [cloudflare(process.env.SNRINTERN_STATE ? { persistState: { path: process.env.SNRINTERN_STATE } } : {})],
  server: { fs: { allow: [repoRoot] } },
});
