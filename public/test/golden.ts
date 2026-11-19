// Golden test: the site must answer the same on two hosts, url for url.
//   bun public/test/golden.ts <reference-origin> <candidate-origin>
// For every url it compares status, redirect target, cache and preload headers, content type and a hash of the body.
// Urls come from the files in site/ (each page in its extensionless, .html and trailing-slash forms), every
// _redirects rule, and missing pages. Writes test/artifacts/golden-<candidate host>.json and exits 1 on any difference.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [reference, candidate] = process.argv.slice(2).map((o) => o.replace(/\/$/, ""));
if (!reference || !candidate) throw new Error("usage: bun public/test/golden.ts <reference-origin> <candidate-origin>");

const site = join(import.meta.dir, "../site");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

const urls = new Set<string>(["/", "/index.html", "/no-such-page", "/src/no-such-writeup", "/assets/no-such-file.png"]);
for (const file of walk(site)) {
  const path = "/" + relative(site, file);
  if (path === "/_headers" || path === "/_redirects") continue;
  urls.add(path);
  if (path.endsWith(".html") && path !== "/index.html") {
    const bare = path.slice(0, -5);
    urls.add(bare);
    urls.add(bare + "/");
  }
}
// Every redirect rule's source, with placeholders filled in.
for (const line of readFileSync(join(site, "_redirects"), "utf8").split("\n")) {
  const from = line.trim().split(/\s+/)[0];
  if (!from) continue;
  urls.add(from.replace(":slug", "fourplusone").replace("*", "fourplusone"));
}

type Answer = { status: number; location: string | null; cacheControl: string | null; link: string | null; contentType: string | null; body: string };

async function ask(origin: string, path: string): Promise<Answer> {
  const response = await fetch(origin + path, { redirect: "manual", headers: { "cache-control": "no-cache" } });
  // Pages injects its web analytics beacon before </body>; the worker serves the committed bytes. Compare without it.
  const text = new TextDecoder().decode(await response.arrayBuffer());
  // The worker carries the same beacon in the committed html, so strip the beacon from both sides.
  const stripped = text
    .replace(/<!-- Cloudflare Pages Analytics -->.*?<!-- Cloudflare Pages Analytics -->/s, "")
    .replace(/<!-- cloudflare web analytics[^>]*-->\n<script defer src='https:\/\/static\.cloudflareinsights\.com[^\n]*<\/script>\n/, "")
    // Bot fight mode injects a challenge script with a per-request ray id on every page under the zone.
    .replace(/<script>\(function\(\)\{function c\(\).*?challenge-platform.*?<\/script>/s, "");
  const body = createHash("sha256").update(stripped).digest("hex").slice(0, 16);
  const location = response.headers.get("location");
  const redirect = response.status >= 300 && response.status < 400;
  return {
    status: response.status,
    // Compare redirect targets as paths, since the two hosts differ.
    location: location ? new URL(location, origin + path).pathname : null,
    cacheControl: response.headers.get("cache-control"),
    link: response.headers.get("link"),
    // A redirect's own body and content type are never shown to anyone.
    contentType: redirect ? "(redirect)" : (response.headers.get("content-type")?.split(";")[0] ?? null),
    body: redirect ? "(redirect)" : body,
  };
}

const rows = [];
for (const path of [...urls].sort()) {
  const [want, got] = await Promise.all([ask(reference, path), ask(candidate, path)]);
  const diff = (Object.keys(want) as (keyof Answer)[]).filter((k) => want[k] !== got[k]);
  rows.push({ path, ok: diff.length === 0, diff, want, got });
}

const failed = rows.filter((r) => !r.ok);
const artifacts = join(import.meta.dir, "artifacts");
mkdirSync(artifacts, { recursive: true });
const out = join(artifacts, `golden-${new URL(candidate).host}.json`);
writeFileSync(out, JSON.stringify({ reference, candidate, at: new Date().toISOString(), urls: rows.length, failed: failed.length, rows }, null, 2));

for (const r of failed) {
  console.log(`DIFF ${r.path}`);
  for (const k of r.diff) console.log(`  ${k}: ${JSON.stringify(r.want[k])} -> ${JSON.stringify(r.got[k])}`);
}
console.log(`${rows.length - failed.length}/${rows.length} urls identical. artifact: ${out}`);
process.exit(failed.length ? 1 : 0);
