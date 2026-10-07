# adhikrish.cloud

static html and css, deployed from `main` through cloudflare pages. no build step or application javascript is needed.

`/essays` serves `essays.html` for thoughts and notes. `/src` serves `src.html`, titled "things i've built" in the navigation and on the page. its two groups are "spacecraft simulations" and "others". the homepage links read "things i've built", "contact@adhikrish.cloud", "linkedin", and "github". cloudflare pages serves the generated html at extensionless paths; nginx uses the same lookup. legacy `/etc` and `/projects` paths redirect permanently to the canonical paths. `404.html` makes missing pages return a real 404 instead of the homepage.

to publish an essay, copy `templates/essay.html.tmpl` to `essays/essay-title.html`. replace its tokens with the title, description, url slug, publication date, last edited date, and body html. use the latest commit affecting the essay for its last edited date. the template shows the date alone, followed by a smaller last edited line. link the essay from `essays.html`, newest publication date first. use ISO dates in `time datetime` and readable dates in the visible text. edits do not change an essay's place in the publication list. keep font and image urls absolute so nested pages load them correctly. when adding the first essay, add `COPY essays/ /usr/share/nginx/html/essays/` to the dockerfile.

repository-backed entries use first commit dates in UTC, not github repository creation dates. each title opens a local reading page with the date alone and a smaller code updated line from the repository's latest commit. its github link opens the repository in a new tab. standalone write-ups can have a `title` and `website` instead of repository metadata. they omit commit dates and link to the product website.

to update an entry, edit its markdown in `content/projects/` and its metadata in `content/projects.json`. set `group` to `spacecraft-simulations` or `others`. these are authored engineering write-ups checked against the pinned source code, not copies of repository readmes. lead with the system flow, the important implementation choices, evidence from the tests, and the limits of the model. keep the first commit date and commit id unchanged when editing a write-up. update `edited_date` from the latest github commit date and `source_commit` to that commit's id. `source_commit` also pins relative documentation and code links to the version reviewed for that page. images use local files with a content hash in their names. `webp_images` maps each PNG fallback to a pixel-identical lossless WebP. generated picture elements let the browser choose one format. keep both image files and update both mappings when a plot changes.

`content/projects/tryshipy.md` is a deliberately authored public system-design overview. it describes component roles and information flow with ASCII diagrams. it names the actual providers and components, including cloudflare workers, hyperdrive, the private database tunnel, rds, s3, sqs, lambda, clef, fireworks, and dynamodb. it explains their boundaries, durability, scaling, and recovery without copying the private README or exposing credentials, infrastructure identifiers, customer data, prompts, matching rules, or operating thresholds. its public product name is shipy, linked to https://tryshipy.com; the existing /src/tryshipy route remains stable. review the deployed configuration and current code before updating or publishing it.

run `python3 scripts/render-projects.py` after changing content. it requires Python 3 and Pandoc, updates the grouped index in `projects.html`, writes the served index to `src.html`, and writes static reading pages to `src/`. it also mirrors the generated pages to the legacy `projects/` directory; legacy URLs redirect to `/src`. commit the generated html with the source markdown. visitors receive plain html, css, and images; no markdown renderer or github request runs in their browser. the removed agent-squad entry retains its unlisted reading page.

the page preloads a local copy of the exact inter v20 latin font previously served by google fonts. keeping that file unchanged preserves its rendering. the font license is in `font-licenses/inter-OFL.txt`.

`_headers` sets caching for cloudflare pages. it also supplies the font preload header for pages' early hints, which can start the font request before the html arrives. `nginx.conf` applies the same cache policy to the alternate docker deployment:

- html: five minutes, then revalidate. a deployed text change may take five minutes to appear in an existing browser cache.
- the font: one year, immutable. its filename contains its sha256 prefix. change the filename and every preload and font reference whenever the font changes.
- hashed project images and the PNG favicon: one year, immutable. the legacy favicon and social preview image: one day, then revalidate. change the url when an image needs an immediate cache refresh.

run locally with `python3 -m http.server 8000`. this server does not apply the production cache headers or extensionless routes; visit `/essays.html` there.

to test the alternate deployment, build with `docker build -t adhikrish-cloud .` and run with `docker run --rm -p 8000:80 adhikrish-cloud`.

project plots use lossless WebP where supported, with the original PNGs as fallbacks. the opening plot loads eagerly with high fetch priority because it appears in the initial reading viewport; later images remain lazy. image dimensions reserve their layout space.

the favicon uses one opaque 48px square PNG, cropped from the supplied sunset photograph, to avoid downloading multiple icon formats. its hashed asset is 3,541 bytes. the root `favicon.png` provides the same image at the legacy URL. retain older hashed assets so cached HTML can still request them. the exact Inter font remains unchanged. cloudflare analytics and browser bot checks remain enabled. these injected scripts add requests and browser work even though the application itself has no javascript.

the homepage gives browsers a low-priority prefetch hint for `/src`. browsers that honor it can load the first navigation from cache. the hint does not replace the normal link or guarantee prefetch on every browser or connection.
