// Render checked-in write-ups into static html. Requires Bun and Pandoc 3.8 or newer.
//   bun public/scripts/render-projects.ts
// Writes public/site/src.html (the index), public/site/src/<slug>.html and the legacy mirror
// public/site/projects/<slug>.html, and refreshes the navigation preloader in public/site/index.html.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Project = {
  slug: string;
  title?: string;
  description: string;
  date?: string;
  edited_date?: string;
  first_commit?: string;
  source_commit?: string;
  status?: string;
  website?: string;
  website_label?: string;
  images: Record<string, string>;
  webp_images?: Record<string, string>;
};

const ROOT = join(import.meta.dir, ".."); // public/
const SITE = join(ROOT, "site"); // the directory that gets deployed
const DESIGN = join(ROOT, "..", "design"); // styles shared with the private sites
const PROJECTS: Project[] = JSON.parse(readFileSync(join(ROOT, "content/projects.json"), "utf8"));
const INDEX_DESCRIPTION = "things i've built.";
const READING_CSS = `
  .project h1 { font-size: 30px; overflow-wrap: anywhere; }
  .project-meta { color: #8a8a8a; font-size: 13px; margin-top: 12px; }
  .project-meta a { color: inherit; }
  .project-meta .last-edited { display: block; font-size: 12px; margin-top: 4px; }
  .readme { margin-top: 44px; line-height: 1.75; }
  .readme p, .readme ul, .readme ol { margin-block: 24px; }
  .readme > :first-child { margin-top: 0; }
  /* The opening paragraph says why the project exists; it reads as the lede. */
  .readme > p:first-child { font-size: 19px; line-height: 1.65; color: #efebe0; }
  .readme h2 { font-size: 20px; font-weight: 550; line-height: 1.4; color: #efebe0; letter-spacing: -0.02em;
               margin: 56px 0 16px; padding-top: 28px; border-top: 1px solid #1f1f1c; }
  .readme h2 + p { margin-top: 0; }
  .readme h3 { font-size: 17px; font-weight: 550; line-height: 1.5; margin: 32px 0 12px; }
  .readme ul, .readme ol { padding-left: 22px; }
  .readme li + li { margin-top: 10px; }
  .readme li::marker { color: #6a6a66; }
  .readme a { color: inherit; overflow-wrap: anywhere; }
  .readme a:hover, .project-meta a:hover { color: #787878; }
  .readme strong { font-weight: 550; color: #efebe0; }
  .readme code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
  .readme :not(pre) > code { overflow-wrap: anywhere; padding: 1px 5px; background: #151513; border-radius: 3px; }
  .readme pre { max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; padding: 16px 18px; margin-block: 28px;
                background: #121210; border: 1px solid #252522; border-radius: 4px; line-height: 1.7; font-size: 13px; }
  .readme pre code { font-size: inherit; }
  .readme .table-scroll { max-width: 100%; overflow-x: auto; margin-block: 28px; }
  .readme table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .readme th, .readme td { padding: 8px 12px; border-bottom: 1px solid #252522; text-align: left; vertical-align: top; }
  .readme figure { margin-block: 36px; }
  .readme picture { display: block; }
  .readme img { display: block; max-width: 100%; height: auto; border-radius: 4px; }
  .readme figcaption { color: #8a8a8a; font-size: 13px; margin-top: 12px; }
  /* Inline svg diagrams: drawn in the page palette, scroll sideways on narrow phones instead of shrinking text. */
  .readme figure.diagram { overflow-x: auto; }
  .readme figure.diagram svg { display: block; width: 100%; min-width: 560px; height: auto; }
  .readme .d-box { fill: #121210; stroke: #3a3a35; }
  .readme .d-store { fill: #0d0d0b; stroke: #3a3a35; }
  .readme .d-t { fill: #e6e2d6; font-size: 13px; font-weight: 550; }
  .readme .d-s { fill: #8a8a8a; font-size: 11px; }
  .readme .d-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 400; }
  .readme .d-line { stroke: #6a6a66; stroke-width: 1.2; fill: none; }
  .readme .d-dash { stroke-dasharray: 4 4; }
  .readme .d-arrow { fill: #6a6a66; }
  .readme .d-warn { fill: #d9a441; font-size: 11px; }
  @media (max-width: 720px) {
    .project h1 { font-size: 26px; }
    .readme > p:first-child { font-size: 18px; }
  }
`;

const read = (path: string) => readFileSync(path, "utf8");

/** Same as python's html.escape(value, quote=True). */
function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

/** Replace each `/* @design <file> *\/` line with that file from design/, verbatim. */
function inlineDesign(page: string): string {
  return page.replace(/^\/\* @design ([\w.-]+) \*\/\n/gm, (_, file) => read(join(DESIGN, file)));
}

/** Keep the small cache warmer identical in every served portfolio page. */
function preloadNavigation(page: string): string {
  const script = read(join(ROOT, "scripts/navigation-preload.js")).trim();
  const block = `<!-- navigation-preload:start -->\n<script>\n${script}\n</script>\n<!-- navigation-preload:end -->`;
  page = page.replace(/<!-- navigation-preload:start -->[\s\S]*?<!-- navigation-preload:end -->\n?/g, "");
  if (page.split("</body>").length !== 2) throw new Error("page must have exactly one closing body tag");
  return page.replace("</body>", () => `${block}\n</body>`);
}

function readableDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return `${months[month - 1]} ${day}, ${year}`;
}

function pandoc(source: string, from: string, to: string): string {
  const run = Bun.spawnSync(["pandoc", "--from", from, "--to", to, "--syntax-highlighting=none"], { stdin: Buffer.from(source) });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return run.stdout.toString();
}

const hasScheme = (url: string) => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);

function prepareAst(node: unknown, project: Project, imageState: { seen: boolean }): void {
  if (Array.isArray(node)) {
    for (const value of node) prepareAst(value, project, imageState);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as { t?: string; c?: any };
  if (record.t === "Link" || record.t === "Image") {
    const [attributes, , target] = record.c;
    const url: string = target[0];
    if (record.t === "Image") {
      const firstImage = !imageState.seen;
      imageState.seen = true;
      target[0] = project.images[url];
      const bytes = readFileSync(join(SITE, target[0].replace(/^\/+/, "")));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      attributes[2].push(["width", String(view.getUint32(16))], ["height", String(view.getUint32(20))],
        ["loading", firstImage ? "eager" : "lazy"], ["decoding", "async"]);
      // The opening plot is visible in the initial reading viewport.
      if (firstImage) attributes[2].push(["fetchpriority", "high"]);
    } else if (!hasScheme(url) && !url.startsWith("#")) {
      // Relative links resolve against the source commit the write-up was checked against.
      if (!project.source_commit) throw new Error(`relative link requires a pinned commit: ${url}`);
      target[0] = new URL(url, `https://github.com/adhikrysh/${project.slug}/blob/${project.source_commit}/`).toString();
    }
    if (record.t === "Link" && target[0].startsWith("https:")) {
      attributes[2].push(["target", "_blank"], ["rel", "noopener noreferrer"]);
    }
  }
  for (const value of Object.values(record)) prepareAst(value, project, imageState);
}

// The index: one entry per write-up, in the order of content/projects.json.
let index = inlineDesign(read(join(ROOT, "templates/src.html")));
const items = PROJECTS.map((project) => {
  const title = escape(project.title ?? project.slug);
  const aside = project.date
    ? `<time datetime="${project.date}">${readableDate(project.date)}</time>`
    : project.status ? `<small>${escape(project.status)}</small>` : "";
  return `          <li>
            <a href="/src/${project.slug}"><span>${title}</span>${aside}</a>
            <p>${escape(project.description)}</p>
          </li>`;
});
const markers = /<!-- project-index:start -->[\s\S]*?<!-- project-index:end -->/g;
if ((index.match(markers) ?? []).length !== 1) throw new Error("project index must have exactly one pair of markers");
index = index.replace(markers, () => `<!-- project-index:start -->\n      <ul class="project-list">\n${items.join("\n")}\n      </ul>\n      <!-- project-index:end -->`);
index = preloadNavigation(index);
writeFileSync(join(SITE, "src.html"), index);
const homePath = join(SITE, "index.html");
writeFileSync(homePath, preloadNavigation(read(homePath).replaceAll('<link rel="prefetch" href="/src">\n', "")));

for (const project of PROJECTS) {
  const slug = project.slug;
  const markdown = read(join(ROOT, "content/projects", `${slug}.md`));
  const ast = JSON.parse(pandoc(markdown, "gfm", "json"));
  if (ast.blocks.length && ast.blocks[0].t === "Header" && ast.blocks[0].c[0] === 1) ast.blocks.shift();
  prepareAst(ast, project, { seen: false });
  let body = pandoc(JSON.stringify(ast), "json", "html5");
  body = body.replace(/(<table>[\s\S]*?<\/table>)/g, '<div class="table-scroll" tabindex="0">$1</div>');
  // Keep the original PNG as a fallback; modern browsers download only the lossless WebP.
  body = body.replace(/(<img src="([^"]+)"[^>]*>)/g, (img, _whole, src) => {
    const webp = project.webp_images?.[src];
    return webp ? `<picture><source srcset="${escape(webp)}" type="image/webp">${img}</picture>` : img;
  });
  const title = escape(project.title ?? slug);
  const head = index.split("</head>")[0]
    .replace(/^  \.project-list[^\n]*\n/gm, "")
    .replaceAll("things i've built | adhikrish rk", `${title} | adhikrish rk`)
    .replaceAll(INDEX_DESCRIPTION, escape(project.description))
    .replaceAll('content="website"', 'content="article"')
    .replaceAll('href="https://adhikrish.cloud/src"', `href="https://adhikrish.cloud/src/${slug}"`)
    .replaceAll("</style>", READING_CSS + "</style>");
  const repository = project.source_commit ? `https://github.com/adhikrysh/${slug}` : undefined;
  const externalUrl = repository ?? project.website;
  const externalLabel = repository ? "github" : project.website_label ?? `visit ${slug}`;
  const externalLink = externalUrl
    ? `      <a class="external" href="${escape(externalUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${externalLabel} (opens in a new tab)" title="opens in a new tab">${externalLabel}</a>`
    : "";
  let metadata = "";
  if (project.status) metadata = `      <p class="project-meta">${escape(project.status)}</p>\n`;
  if (project.date) {
    metadata = `      <p class="project-meta">
        <a href="${repository}/commit/${project.first_commit}" target="_blank" rel="noopener noreferrer"><time datetime="${project.date}">${readableDate(project.date)}</time></a>
        <span class="last-edited">code updated <a href="${repository}/commit/${project.source_commit}" target="_blank" rel="noopener noreferrer"><time datetime="${project.edited_date}">${readableDate(project.edited_date!)}</time></a></span>
      </p>
`;
  }
  const page = preloadNavigation(`${head}</head>
<body>
  <div class="reading">
    <nav aria-label="site">
      <a href="/">home</a>
      <a href="/src">things i've built</a>
${externalLink}
    </nav>
    <main class="project">
      <h1>${title}</h1>
${metadata}      <div class="readme">
${body}      </div>
    </main>
  </div>
</body>
</html>
`);
  for (const directory of ["src", "projects"]) {
    mkdirSync(join(SITE, directory), { recursive: true });
    writeFileSync(join(SITE, directory, `${slug}.html`), page);
  }
  console.log(`rendered src/${slug}.html`);
}
