# AGENTS.md (adhikrish.cloud)

Rules for this repo only. The global AGENTS.md still applies.

## Write-ups

- Write-ups live in `content/projects/<slug>.md`. The order of `content/projects.json` is the order on `/src`. Run `python3 scripts/render-projects.py` after any change and commit the generated html with the source.
- Write them in Adhi's voice with the `write-like-adhi` skill. Lead with the idea, written to the reader, never centred on him and never lecturing. The reference opener is fourplusone's: "it's easy to lose mental alignment with your codebase when you build with agents..."
- The first paragraph says why the project exists, the problem it solves and its impact. Then plain sections. Claim only what the code, the tests or Adhi's own words back up.

## Diagrams

- Use inline SVG diagrams instead of ASCII, as many as genuinely make the mechanism clearer. Adhi likes diagrams.
- Each one is `<figure class="diagram"><svg viewBox="0 0 600 H" role="img" aria-label="...">...</svg><figcaption>...</figcaption></figure>`, with no blank lines inside the figure.
- Style only with the `.d-*` classes in `READING_CSS` (`scripts/render-projects.py`). Give every arrow marker id a per-file prefix.
- Every box and number comes from real facts. Label schematics as schematic in the caption.
- After rendering, measure every label against its box in the browser (`getBBox`). Estimates from character counts miss.
