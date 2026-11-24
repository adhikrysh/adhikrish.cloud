# AGENTS.md (docs/: how the system works)

Docs for whoever maintains this repo next. The repo-root AGENTS.md and the global AGENTS.md still apply. Every doc about how the system works lives here: mechanisms and runbooks. A file that ships with one service stays with that service, like senior intern's api contract (`private/snrintern/API.md`), which the worker serves and a test checks. Folder READMEs only say what a folder holds and link here; public write-ups stay in `public/content/`.

## The repo is public

Explain the concept, never the private specifics. Before writing anything down, check it against this list.

- Never: secret values (tokens, passwords, keys, client secrets), email addresses, which person or device has access to what, private ip addresses, token or policy ids, anything copied from a live config that isn't already in git.
- Fine: hostnames already in `services.json`, names of 1password items (never their contents), roles ("the owner", "a family member", "a device token"), the shape of the setup, and generic placeholders like `<app>.adhikrish.cloud`.
- When a real example would help but is private, use a placeholder and describe the role.

## How to write a doc

Write so a reader with no chat history can rebuild the model, not just memorise it.

1. Open with the question the doc answers and the shortest correct answer.
2. Introduce one object at a time, defining each term before using it.
3. Trace one concrete request or object through the whole mechanism, in causal order, with an ascii diagram where it helps.
4. For every misconception that has actually confused someone, keep three parts: the wrong model, why it fails, and the model that replaces it.
5. Add cases the reader can predict: one success, one refusal, one failure in the middle, and one changed premise.
6. State the invariants (what must always hold) and how to change the system safely.
7. Keep facts, decisions and open questions visibly apart. Put the unverified ones under "open questions".

Plain words, short sentences, lowercase prose like the rest of the private docs, no filler. Link to the code that enforces a claim. If the code changes, the doc changes in the same commit.

## Index

- [`access.md`](access.md): cloudflare access apps, policies, service tokens, bypasses, and the signed pass.
- [`add-a-service.md`](add-a-service.md): runbook for putting a new self-hosted app behind the tunnel.
- [`uptime-probes.md`](uptime-probes.md): how the uptime page checks every service: the timer, placement near singapore, the three roads, and who can start a probe.
- [`latency.md`](latency.md): measuring each request phase before tuning anything.
- [`health.md`](health.md): garmin into senior intern: the hourly cron, its request budget and backfill, rows and streams, and how the health page judges a day.
- [`training.md`](training.md): garmin activities and the agent's sessions as one training log: who owns which field, how a session is matched both ways, the one delete, and what the page and `/_views` compute (load, run limit, weeks, records).
