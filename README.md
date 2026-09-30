# adhikrish.cloud

static html and css, deployed from `main` through cloudflare pages. no build step or application javascript is needed.

the page preloads a local copy of the exact inter v20 latin font previously served by google fonts. keeping that file unchanged preserves its rendering. the font license is in `font-licenses/inter-OFL.txt`.

`_headers` sets caching for cloudflare pages. it also supplies the font preload header for pages' early hints, which can start the font request before the html arrives. `nginx.conf` applies the same cache policy to the alternate docker deployment:

- html: five minutes, then revalidate. a deployed text change may take five minutes to appear in an existing browser cache.
- the font: one year, immutable. its filename contains its sha256 prefix. change the filename and both references in `index.html` whenever the font changes.
- images: one day, then revalidate. change the url when an image needs an immediate cache refresh.

run locally with `python3 -m http.server 8000`. this server does not apply the production cache headers.

to test the alternate deployment, build with `docker build -t adhikrish-cloud .` and run with `docker run --rm -p 8000:80 adhikrish-cloud`.
