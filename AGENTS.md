# AGENTS.md (adhikrish.cloud)

One repo for everything under `*.adhikrish.cloud`. The global AGENTS.md still applies. Subfolders add their own rules (`public/AGENTS.md`).

## Map

| path | what | runs on | deploys when |
|---|---|---|---|
| `public/` | adhikrish.cloud, static site (`public/site/` is what gets served) | cloudflare worker, assets only (`public/cloudflare.config.ts`) | `.github/workflows/public.yml` |
| `private/admin/` | uptime.adhikrish.cloud: links + live health of every service | cloudflare worker | `.github/workflows/admin.yml` |
| `private/snrintern/` | seniorintern.adhikrish.cloud ("senior intern"): people, forecasts, training, body, books, health; json api for the personal agents (contract: `private/snrintern/API.md`); an hourly cron pulls garmin into health (`src/garmin.ts`) | cloudflare worker + d1 + cron | `.github/workflows/snrintern.yml` |
| `private/infra/` | the thinkpad's compose files, scripts, configs, runbooks | thinkpad | by hand (see `private/infra/README.md`) |
| `docs/` | how the cross-cutting mechanisms work (start with `docs/access.md`); rules for writing them in `docs/AGENTS.md` | | |
| `design/` | shared css (`base.css`, `list.css`) and the html shell for the private sites (`html.ts`) | | triggers every site |
| `services.json` | the list of services: the uptime page's links and health probes | | triggers admin |

The full write-up of how it all fits together, including restart handling and failure modes: `public/content/projects/adhikrish-cloud.md` (served at /src/adhikrish-cloud).

## Where to add things

- **A self-hosted service:** follow `docs/add-a-service.md`. Its last step adds one entry to `services.json` (`name`, `url`, optional `health` url, `about`). The uptime page picks it up on the next deploy.
- **A senior intern tab or column:** no code and no migration. The schema is data in d1: `PUT /api/_tabs/<slug>` with the definition (see `private/snrintern/API.md`). Rows are json documents checked against it (`private/snrintern/src/schema.ts`), and every change lands in `/api/_log`. What a tab opens on (charts, due lists) is the definition's `views` (`src/views.ts`), so a new tab or exercise needs no code. Migrations are only for the storage itself (`tabs`, `rows`, `schema_log`).
- **A write-up:** see `public/AGENTS.md`.

## Rules

- Public vs private is about access, not hosting. Everything private sits behind cloudflare access; senior intern also verifies the access jwt itself (`private/snrintern/src/auth.ts`). How apps, policies, service tokens and bypasses decide who gets in: `docs/access.md`.
- No secrets in git, ever. 1password is the source of truth:
  - vault `adhikrish.cloud-ci` (the only vault ci can read, through the service account "github-actions adhikrish.cloud", whose token is the github secret `OP_SERVICE_ACCOUNT_TOKEN`): `cloudflare-deploy` (api token: workers + d1 write, workers routes + dns write on adhikrish.cloud) and `access-uptime-prober` (the uptime prober's access service token).
  - the agents' access service tokens, one per agent, each with its own service-auth policy on `seniorintern_app` and its client id in `AGENT_CLIENT_IDS` in `private/snrintern/cloudflare.config.ts`: `snrintern dots token` (vault `adhikrish.cloud-ci`) and `snrintern instinct token` (vault `adhikrish.cloud-ci`).
  - vault `Personal`: `garmin personal api key` (garmin's official Personal API, made in garmin connect web > settings > personal api key; the worker secret `GARMIN_API_KEY`). it **does** expire: 2027-11-23, garmin emails a week before. make a new one, then `cf` the secret again.
  - the rest don't expire. revoke in cloudflare (zero trust > service tokens, or profile > api tokens) if one leaks.
  - the thinkpad keeps per-app `.env` files that are never committed.
- Anything that must work while the thinkpad is off runs on cloudflare (the public, uptime and senior intern workers, d1). The thinkpad only runs the self-hosted apps in `private/infra/`. Stay inside cloudflare's free plan (workers: 100k requests/day, 10 ms cpu each; d1: 5M rows read, 100k written per day, 5 GB).
- One design for every site: `design/base.css` + `design/list.css` (through `design/html.ts` on the private sites, through the templates on the public one). Every size and colour is a variable in `base.css` (`--fs-*`, `--muted`, `--good`, ...); never write a literal.
  - links are always underlined; in a list row only the title is. no focus boxes: a focused link dims like a hovered one.
  - green (`--good`) and red (`--bad`) mean state, nothing else. labels and section headings are white pills; a state can be an outlined pill (white, green or red border).
  - every page below the top starts with a `←` to its parent instead of a link with the parent's name.
  - minimal: no counts, no dot separators, no filler words, no hardcoded targets or thresholds (show what happened, compare with its own history).
- Code is typescript. The exceptions: the thinkpad's scripts in `private/infra/scripts/` are bash, and `public/scripts/navigation-preload.js` is plain js because it is inlined into pages. The public renderer is `public/scripts/render-projects.ts` (bun + pandoc).
- Tests are end-to-end only. `cd private/snrintern && bun test` runs the worker in workerd on local d1 against a fake access key server, defines tabs from `test/fixtures/tabs.json` (keep it in step with production's definitions), and writes `test/artifacts/`. Admin: `cd private/admin && npm run check`, then `npx vite dev` to probe the real hostnames locally. Public: `bun public/test/golden.ts <reference-origin> <candidate-origin>` asks both hosts every url (every page form, every `_redirects` rule, missing pages) and compares status, redirect target, cache headers, content type and body; run it before any change to `public/cloudflare.config.ts`, `_headers` or `_redirects`, against a `workersDev` copy. It writes `public/test/artifacts/`.
- Cloudflare is managed with the `cf` cli (profile `adhi` is bound to this folder). Read freely; ask before any change.
- Bot defences: browser integrity check is on for the whole zone. One configuration rule (`http_config_settings`) turns it off for `seniorintern.adhikrish.cloud/api*`, because the agents' python clients (user agent `Python-urllib`) are otherwise refused with error 1010 before access runs; access still demands a service token there. The rule matches on the hostname, so renaming the host means updating the rule (it pointed at the old `snrintern.` name until 2026-11-21). Bot fight mode is off for the zone since 2026-11-21: it served instinct a "just a moment" challenge (likely its datacenter ip), it can't be exempted per host or path on the free plan, and waf skip rules don't reach it. Access still guards every private name. Turn it back on only with a way to keep the agents out of it.
- Leave changes uncommitted for review unless told otherwise.
