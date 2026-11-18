// Shared page shell for the private sites (admin, snrintern).
// The public site inlines the same base.css and list.css through public/scripts/render-projects.ts.
// Each app loads the two css files its own way (vite `?raw` in the worker, Bun.file in snrintern)
// and passes them in as `design`.
export type Design = { base: string; list: string };

// Shared by every private page: a white pill for labels, green for good, red for bad. Nothing else is coloured.
const PRIVATE = `
  .pill { display: inline-block; font-size: 12px; line-height: 1.6; padding: 0 9px; border-radius: 10px; background: #d8d4c8; color: #080807; white-space: nowrap; letter-spacing: 0; }
  .good { color: #6f9e6a; }
  .bad { color: #c4553f; }
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
