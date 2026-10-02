# adhikrish.cloud

static html and css, deployed from `main` through cloudflare pages. no build step or application javascript is needed.

`/essays` serves `essays.html` for thoughts and notes. `/projects` serves `projects.html` for personal projects. cloudflare pages serves html files at extensionless paths; nginx uses the same lookup. legacy `/etc` and `/src` paths redirect permanently to these canonical paths. `404.html` makes missing pages return a real 404 instead of the homepage.

to publish an essay, copy `templates/essay.html.tmpl` to `essays/essay-title.html`. replace its tokens with the title, description, url slug, publication date, last edited date, and body html. use the latest commit affecting the essay for its last edited date. the template shows the date alone, followed by a smaller last edited line. link the essay from `essays.html`, newest publication date first. use ISO dates in `time datetime` and readable dates in the visible text. edits do not change an essay's place in the publication list. keep font and image urls absolute so nested pages load them correctly. when adding the first essay, add `COPY essays/ /usr/share/nginx/html/essays/` to the dockerfile.

the project list uses first commit dates in UTC, not github repository creation dates. each title opens a local reading page with the date alone and a smaller last edited line from the repository's latest commit. its github link opens the repository in a new tab.

to update a project, edit its markdown in `content/projects/` and its metadata in `content/projects.json`. keep the first commit date and commit id unchanged when editing a readme. update `edited_date` from the latest github commit date and `source_commit` to that commit's id. `source_commit` also pins relative documentation and code links to the version reviewed for that page. images use local files with a content hash in their names. `webp_images` maps each PNG fallback to a pixel-identical lossless WebP. generated picture elements let the browser choose one format. keep both image files and update both mappings when a plot changes.

run `python3 scripts/render-projects.py` after changing project content. it requires Python 3 and Pandoc, updates the project list, and writes static pages to `projects/`. commit the generated html with the source markdown. visitors receive plain html, css, and images; no markdown renderer or github request runs in their browser.

the page preloads a local copy of the exact inter v20 latin font previously served by google fonts. keeping that file unchanged preserves its rendering. the font license is in `font-licenses/inter-OFL.txt`.

`_headers` sets caching for cloudflare pages. it also supplies the font preload header for pages' early hints, which can start the font request before the html arrives. `nginx.conf` applies the same cache policy to the alternate docker deployment:

- html: five minutes, then revalidate. a deployed text change may take five minutes to appear in an existing browser cache.
- the font: one year, immutable. its filename contains its sha256 prefix. change the filename and every preload and font reference whenever the font changes.
- hashed project images and the WebP favicon: one year, immutable. the PNG favicon fallback and social preview image: one day, then revalidate. change the url when an image needs an immediate cache refresh.

run locally with `python3 -m http.server 8000`. this server does not apply the production cache headers or extensionless routes; visit `/essays.html` there.

to test the alternate deployment, build with `docker build -t adhikrish-cloud .` and run with `docker run --rm -p 8000:80 adhikrish-cloud`.

project plots and the favicon use lossless WebP where supported, with the original PNGs as fallbacks. the exact Inter font remains unchanged. cloudflare analytics and browser bot checks remain enabled. these injected scripts add requests and browser work even though the application itself has no javascript.

the homepage gives browsers low-priority prefetch hints for `/essays` and `/projects`. browsers that honor them can load the first navigation from cache. hints do not replace normal links or guarantee prefetch on every browser or connection.
