# Favicon and loading verification

The sunset photo now supplies one opaque 48×48 PNG favicon, available at
`/assets/favicon-7330e902055f.png`. Its 3,541 bytes replace the previous
46,228-byte favicon, a 92.3% reduction and 42,687 fewer bytes on a cold visit.
All existing pages and the essay template reference the same hashed asset.
The legacy `/favicon.png` serves the same image. Old hashed assets remain
available for cached HTML. The new hashed icon receives one-year immutable
caching in Cloudflare Pages and nginx.

The first project plot loads eagerly with high fetch priority. Browser
inspection at 390×844 showed its top at 593–680 pixels on the three plot
pages, within the initial viewport. Later images remain lazy. The PNG
fallbacks, lossless WebPs, dimensions, and image decoding policy are unchanged.

The original Inter font remains byte-for-byte unchanged. A trial restricting
its unused variable weight range reduced its size but changed text
rasterization, so it was rejected. Cloudflare analytics, email decoding, and
bot checks remain enabled.

## Controlled measurements

Baseline: commit `de4947c`. Five cold-cache pairs per route, alternating
before/after order. Chromium viewport 390×844, 100 ms network latency,
200,000 bytes/s download, 100,000 bytes/s upload, and 4× CPU slowdown.
Both versions were served locally using the same Python HTTP server.
These tests isolate the source changes; they exclude Cloudflare-injected
scripts, CDN behavior, compression, and production network variability.

Median times in milliseconds:

| Route | First paint before / after | Last asset finished before / after | Opening plot requested before / after |
| --- | ---: | ---: | ---: |
| Home | 320 / 316 | 880 / 669 | — |
| Attitude filter | 348 / 344 | 1114 / 897 | 315 / 154 |
| Orbit access | 344 / 348 | 1226 / 1015 | 313 / 153 |
| Contact router | 340 / 344 | 912 / 739 | 311 / 153 |

Asset completion improved in all 20 pairs, by 170–228 ms. First paint and
layout shift did not show a material change. The document load event also
remained nearly unchanged; the favicon finishes after that event. Earlier
plot requests did not consistently improve largest-content paint, so this
change does not claim a first-paint or largest-content-paint speedup.

Raw observations and the Playwright CLI benchmark are saved locally under
`output/playwright/favicon-performance/`. That directory is ignored by git.

## Appearance and correctness

Ten routes were checked at 320px and 1440px widths, before and after.
All ten screenshot pairs for the homepage, project index, and three plot
pages were pixel-identical after fonts and images loaded. Page text and
navigation links matched across all routes. No horizontal page overflow
or broken images appeared. Every page advertises exactly one favicon.
The project renderer produced identical output on its second run.

## Favicon provenance

The supplied HEIC was converted to PNG for inspection. The built-in image
tool received this edit prompt:

> Edit target: the supplied photograph. Make a square favicon source by cropping ONLY: remove the leftmost quarter of this 4032x3024 image, keeping the rightmost 3024x3024 square, full original vertical framing. Preserve the same person facing the ocean on the right, dark silhouette, sunglasses, backpack, shoreline and sunset colors exactly. No retouching, no relighting, no illustration, no new objects, no text or border. This is solely a faithful square crop of the original photograph for a small browser favicon. Keep the image opaque.

The selected square output was downscaled to 48×48 and encoded as an opaque,
optimized PNG. It was inspected at 16, 32, 48, and 64 pixels. The full-size
source is not shipped to visitors.

The alternate Docker deployment built successfully. `nginx -t`, canonical
routes, query-preserving legacy redirects, real 404 responses, and immutable
caching for the new favicon passed local checks.
