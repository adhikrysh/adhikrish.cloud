# AGENTS.md (adhikrish.cloud)

One repo for everything under `*.adhikrish.cloud`. The global AGENTS.md still applies. Subfolders add their own rules (`public/AGENTS.md`).

## Map

| path | what | runs on | deploys when |
|---|---|---|---|
| `public/` | adhikrish.cloud, static site (`public/site/` is what gets served) | cloudflare pages | `public/**` or `design/**` changes (pages build watch paths) |
| `private/admin/` | admin.adhikrish.cloud: links + live health of every service | cloudflare worker | `.github/workflows/admin.yml` |
| `private/snrintern/` | snrintern.adhikrish.cloud: people / outbound / forecasts / gym, json api for the personal agent | cloudflare worker + d1 | `.github/workflows/snrintern.yml` |
| `private/infra/` | the thinkpad's compose files, scripts, configs, runbooks | thinkpad | by hand (see `private/infra/README.md`) |
| `design/` | shared css (`base.css`, `list.css`) and the html shell for the private sites (`html.ts`) | | triggers every site |
| `services.json` | the list of services: admin's links and health probes | | triggers admin |

The full write-up of how it all fits together, including restart handling and failure modes: `public/content/projects/adhikrish-cloud.md` (served at /src/adhikrish-cloud).

## Where to add things

- **A self-hosted service:** follow `private/infra/docs/add-a-service.md`. Its last step adds one entry to `services.json` (`name`, `url`, optional `health` url, `about`). Admin picks it up on the next deploy.
- **An external link on admin:** one entry under `external` in `services.json`.
- **A snrintern tab:** one entry in `private/snrintern/src/tabs.ts` plus one migration in `private/snrintern/migrations/` creating its table (next number, never edit an applied one; ci applies it). The api, page and csv import read the registry, and `GET /api` lists it, so the agent learns it without any api change.
- **A write-up:** see `public/AGENTS.md`.

## Rules

- Public vs private is about access, not hosting. Everything private sits behind cloudflare access; snrintern also verifies the access jwt itself (`private/snrintern/src/auth.ts`).
- No secrets in git, ever. 1password is the source of truth. CI reads secrets through a 1password service account (`op://adhikrish.cloud-ci/...` references in the workflows). The thinkpad keeps per-app `.env` files that are never committed.
- Anything that must work while the thinkpad is off runs on cloudflare (pages, the admin and snrintern workers, d1). The thinkpad only runs the self-hosted apps in `private/infra/`. Stay inside cloudflare's free plan (workers: 100k requests/day, 10 ms cpu each; d1: 5M rows read, 100k written per day, 5 GB).
- Keep the private sites in the site's design: `design/base.css` + `design/list.css` through `design/html.ts`. Do not fork the css per app; add page-specific rules through the `css` argument.
- Everything in this repo is typescript. The public renderer is `public/scripts/render-projects.ts` (bun + pandoc).
- Tests are end-to-end only. `cd private/snrintern && bun test` runs the worker in workerd on local d1 against a fake access key server and writes `test/artifacts/`. Admin: `cd private/admin && npm run check`, then `npx vite dev` to probe the real hostnames locally.
- Cloudflare is managed with the `cf` cli (profile `adhi` is bound to this folder). Read freely; ask before any change.
- Leave changes uncommitted for review unless told otherwise.
