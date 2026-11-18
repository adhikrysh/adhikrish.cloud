# AGENTS.md (public/: the adhikrish.cloud site)

Rules for the public site. The repo-root AGENTS.md and the global AGENTS.md still apply.

## Layout

- `site/` is exactly what cloudflare pages serves. Hand-written pages (`index.html`, `txt.html`, `404.html`, `nsnip.html`), `_headers`, `_redirects` and `assets/` live here; `src.html`, `src/` and `projects/` are generated.
- `content/`, `templates/` and `scripts/` are sources. They are not served.
- `templates/src.html` pulls shared css from `../design/` through `/* @design <file> */` lines.

## Write-ups

- Write-ups live in `content/projects/<slug>.md`. The order of `content/projects.json` is the order on `/src`. Run `bun public/scripts/render-projects.ts` after any change (or after editing `design/base.css` or `design/list.css`) and commit the generated html with the source.
- Write them in Adhi's voice with the `write-like-adhi` skill. Lead with the idea, written to the reader, never centred on him and never lecturing. The reference opener is fourplusone's: "it's easy to lose mental alignment with your codebase when you build with agents..."
- The first paragraph says why the project exists, the problem it solves and its impact. Then plain sections. Claim only what the code, the tests or Adhi's own words back up.

## Diagrams

- Use inline SVG diagrams instead of ASCII, as many as genuinely make the mechanism clearer. Adhi likes diagrams.
- Each one is `<figure class="diagram"><svg viewBox="0 0 600 H" role="img" aria-label="...">...</svg><figcaption>...</figcaption></figure>`, with no blank lines inside the figure.
- Style only with the `.d-*` classes in `READING_CSS` (`scripts/render-projects.ts`). Give every arrow marker id a per-file prefix.
- Every box and number comes from real facts. Label schematics as schematic in the caption.
- After rendering, measure every label against its box in the browser (`getBBox`). Estimates from character counts miss.
