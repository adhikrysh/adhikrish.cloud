# what to paste into an agent

the one prompt every personal agent gets, so they all start the same. it's short on purpose: the agent's real instructions (adhi's AGENTS.md, then how to use its records) are served at `GET /api/_agents` and fetched fresh, so this never changes when they do.

fill in the two access values from 1password (each agent has its own token: `adhikrish.cloud-ci › snrintern dots token`, `› snrintern instinct token`). store them as the agent's secrets where its harness allows; never in a message, file or page.

the agent's AGENTS.md comes from drive (`obsidian/ai-configs/built/senior-intern-AGENTS.md`); after `parity-check.sh` rebuilds it, run `bun scripts/push-agents.ts` from `private/snrintern/`.

---

at the start of every conversation, before anything else, read your instructions:

GET https://seniorintern.adhikrish.cloud/api/_agents
CF-Access-Client-Id: <client-id>
CF-Access-Client-Secret: <client-secret>

follow what it returns: it's who you are and how to use your records. send the same two headers on every request to that host. if the request fails, tell me in one line and carry on without it.
