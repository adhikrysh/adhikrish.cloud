# adhikrish.cloud

static html and css, deployed from `main` through cloudflare pages. no build step or application javascript is needed.

`/etc` serves `etc.html` for thoughts and notes. `/src` serves `src.html` for personal projects. cloudflare pages serves html files at extensionless paths; nginx uses the same lookup. `404.html` makes missing pages return a real 404 instead of the homepage.

to publish an essay, create `etc/essay-title.html` using the font, colors, and centered reading column from `etc.html`. include the title, canonical url, description, published date, edit history, and body. link it from the list in `etc.html`, newest publication date first. use ISO dates in `time datetime` and readable dates in the visible text. edits stay in the essay's history and do not change its place in the publication list. keep font and image urls absolute so nested pages load them correctly. when adding the first essay, add `COPY etc/ /usr/share/nginx/html/etc/` to the dockerfile.

the project list uses first commit dates in UTC, not github repository creation dates. each title opens a local reading page. its github link opens the repository in a new tab.

to update a project, edit its markdown in `content/projects/` and its metadata in `content/projects.json`. keep the first commit date and commit id unchanged when editing a readme. `source_commit` pins relative documentation and code links to the version reviewed for that page. images use local files with a content hash in their names.

run `python3 scripts/render-projects.py` after changing project content. it requires Python 3 and Pandoc, updates the project list, and writes static pages to `src/`. commit the generated html with the source markdown. visitors receive plain html, css, and images; no markdown renderer or github request runs in their browser.

the page preloads a local copy of the exact inter v20 latin font previously served by google fonts. keeping that file unchanged preserves its rendering. the font license is in `font-licenses/inter-OFL.txt`.

`_headers` sets caching for cloudflare pages. it also supplies the font preload header for pages' early hints, which can start the font request before the html arrives. `nginx.conf` applies the same cache policy to the alternate docker deployment:

- html: five minutes, then revalidate. a deployed text change may take five minutes to appear in an existing browser cache.
- the font: one year, immutable. its filename contains its sha256 prefix. change the filename and every preload and font reference whenever the font changes.
- images: one day, then revalidate. change the url when an image needs an immediate cache refresh.

run locally with `python3 -m http.server 8000`. this server does not apply the production cache headers or extensionless routes; visit `/etc.html` there.

to test the alternate deployment, build with `docker build -t adhikrish-cloud .` and run with `docker run --rm -p 8000:80 adhikrish-cloud`.
