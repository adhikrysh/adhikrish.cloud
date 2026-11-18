// Shared page shell for the private sites (admin, snrintern).
// The public site inlines the same base.css and list.css through public/scripts/render-projects.ts.
// Each app loads the two css files its own way (vite `?raw` in the worker, Bun.file in snrintern)
// and passes them in as `design`.
export type Design = { base: string; list: string };

// Shared by every private page: a white pill for labels, green for good, red for bad. Nothing else is coloured.
// list.css underlines every span in a list row (on the public site that is only the title); here rows also hold
// times, pills and coloured words, so only a row's title, its first span, stays underlined.
const PRIVATE = `
  .project-list span { text-decoration: none; }
  .project-list a > span:first-child { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .pill { display: inline-block; font-size: var(--fs-tiny); line-height: 1.6; padding: 0 9px; border-radius: 10px; background: var(--text); color: var(--bg); white-space: nowrap; letter-spacing: 0; }
  .good { color: var(--good); }
  .bad { color: var(--bad); }
`;

// The font is served once, from the public site, with a CORS header (public/site/_headers).
const FONT = "https://adhikrish.cloud/assets/inter-latin-c940764593d0.woff2";

export function escape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A full html document in the site's reading layout. `css` adds page-specific rules. */
export function page({ design, title, nav, body, css = "" }: { design: Design; title: string; nav: string; body: string; css?: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<link rel="preload" href="${FONT}" as="font" type="font/woff2" crossorigin>
<style>
${design.base.replace("url('/assets/inter-latin-c940764593d0.woff2')", `url('${FONT}')`)}${design.list}${PRIVATE}${css}
</style>
</head>
<body>
  <div class="reading">
    ${nav ? `<nav aria-label="site">${nav}</nav>` : ""}
    <main>
${body}
    </main>
  </div>
</body>
</html>
`;
}
