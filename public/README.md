# adhikrish.cloud (public site)

static html and css in `site/`, served by an assets-only cloudflare worker (`cloudflare.config.ts`, no code). on every push to `main` that touches `public/` or `design/`, `.github/workflows/public.yml` re-renders the site, fails if the committed html differs, then runs `cf deploy site`. every page and link works without javascript; one small inline script only warms the next page's html.

## pages

- `/` (`templates/index.html`): the home page. its links: things i've built, things i've written, the email address, linkedin, github.
- `/src` (`templates/src.html`): "things i've built". projects sit under a white pill per `category`; groups and the projects in them follow the order of `content/projects.json`.
- `/src/<slug>`: one write-up per project, from `content/projects/<slug>.md`.
- `/txt` (`templates/txt.html`): "things i've written".
- `404.html` (`templates/404.html`): makes a missing page a real 404.
- `nsnip.html`: hand-written, separate from the rest.

every page below home starts with a `←` back to its parent. legacy `/etc`, `/essays`, `/projects` and `/projects/<slug>` paths redirect permanently (`site/_redirects`).

## building

`bun public/scripts/render-projects.ts` (bun, and pandoc 3.8 or newer) writes everything generated: `site/index.html`, `site/txt.html`, `site/404.html` and `site/src.html` from the templates, and `site/src/<slug>.html` plus a legacy copy in `site/projects/` from the markdown. the templates pull `design/base.css` and `design/list.css` in through `/* @design <file> */` lines, so a design change reaches every page on the next render. edit the templates, never their copies in `site/`, and commit the generated html with its source.

run it locally with `npx serve public/site`. that server has no extensionless routes or cache headers, so visit `/txt.html` there.

## projects.json

each entry has a `slug`, `description` and `category`, and either a repository's first-commit `date` (utc) with `edited_date` and `source_commit`, or a `status` shown where the date would be (shipy: "revenue generating"). a write-up page shows the date or status as a pill, then "code updated <edited_date>". `source_commit` pins the github link and any relative links to the code that was reviewed. a standalone write-up can set `title`, `website` and `website_label` instead. `images` maps a markdown image to a local file with a content hash in its name, and `webp_images` maps each png to a pixel-identical lossless webp.

how to write one is in `AGENTS.md` (this folder).

## caching (`site/_headers`)

- html: five minutes, then revalidate, so a deploy can take five minutes to show in a browser that already has the page.
- the inter font, hashed project images and the hashed favicon: one year, immutable. their filenames carry a hash; change the name when the file changes.
- `og.png`, the social preview: one day.

the font is a local copy of inter v20 latin, preloaded by every page (and sent early as a `link` header); its licence is `site/font-licenses/inter-OFL.txt`.

## navigation-preload.js

`scripts/navigation-preload.js` fetches linked `/src` pages at low priority into the normal browser cache, so a click lands on a warm page: home warms the index, the index warms its write-ups, and hovering or touching a local link starts its fetch. it skips automatic warming on data-saving or 2g connections and renders nothing. the renderer embeds it in home, the index and every write-up; rerun it after changing the script.

## testing a serving change

before changing `cloudflare.config.ts`, `site/_headers` or `site/_redirects`: set `workersDev: true` and `domains: []` in a scratch copy of the config, `cf deploy site` it, then run `bun public/test/golden.ts https://adhikrish.cloud <the workers.dev url>`. it compares every url and saves the result in `test/artifacts/`. the live site's known, accepted differences from the old pages hosting (2026-11-19): legacy `/projects|/etc|/essays/<slug>.html` links take two redirects, `/index.html`-style urls redirect with 307, and missing pages are sent `max-age=0` (`/src/<missing>` 300s).
