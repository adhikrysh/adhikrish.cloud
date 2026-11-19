// Shared page shell for the private sites (admin, snrintern).
// The public site inlines the same base.css and list.css through public/scripts/render-projects.ts.
// Each worker imports the two css files with vite's `?raw` and passes them in as `design`.
export type Design = { base: string; list: string };

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
<link rel="icon" type="image/png" sizes="96x96" href="https://adhikrish.cloud/assets/favicon-d2c62bf5320a.png">
<style>
${design.base.replace("url('/assets/inter-latin-c940764593d0.woff2')", `url('${FONT}')`)}${design.list}${css}
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
