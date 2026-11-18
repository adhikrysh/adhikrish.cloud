import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The worker imports ../../services.json and ../../design/*, so the dev server may read the repo root.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({ plugins: [cloudflare()], server: { fs: { allow: [repoRoot] } } });
