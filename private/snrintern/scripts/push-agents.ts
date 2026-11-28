// Copies the agent's instructions from drive to senior intern, where agents read them at GET /api/_agents.
// Drive is the source of truth (obsidian/ai-configs/built, written by parity-check.sh); run this after it rebuilds.
// The PUT goes out as you, signed in through access (cloudflared opens the browser the first time): agent tokens can't write it.
//   bun scripts/push-agents.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOST = "https://seniorintern.adhikrish.cloud";
const file = join(import.meta.dir, "..", "senior-intern-AGENTS.md"); // a gitignored link to the built file in drive

const run = (args: string[]) => {
  const r = Bun.spawnSync(["cloudflared", "access", ...args]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};
run(["login", "--quiet", HOST]); // reuses a saved login while it's valid
const token = run(["token", `-app=${HOST}`]);

const res = await fetch(`${HOST}/api/_agents`, { method: "PUT", headers: { "cf-access-token": token, "content-type": "text/markdown" }, body: readFileSync(file, "utf8") });
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
