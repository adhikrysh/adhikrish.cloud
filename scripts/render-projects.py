#!/usr/bin/env python3
"""Render checked-in readmes and public write-ups. Requires Python 3 and Pandoc."""

import html
import json
import re
import struct
import subprocess
from datetime import date
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = json.loads((ROOT / "content/projects.json").read_text())
GROUPS = [("spacecraft-simulations", "spacecraft simulations"), ("others", "others")]
INDEX_DESCRIPTION = "spacecraft simulations and other things i've built."
READING_CSS = """
  nav { flex-wrap: wrap; }
  nav .external { margin-left: auto; }
  .project h1 { font-size: 28px; overflow-wrap: anywhere; }
  .project-meta { color: #8a8a8a; font-size: 13px; margin-top: 12px; }
  .project-meta a { color: inherit; }
  .project-meta .last-edited { display: block; font-size: 12px; margin-top: 4px; }
  .readme { margin-top: 40px; line-height: 1.8; }
  .readme p, .readme ul, .readme ol { margin-block: 20px; }
  .readme > :first-child { margin-top: 0; }
  .readme h2 { font-size: 20px; font-weight: 450; line-height: 1.4; margin: 48px 0 20px; letter-spacing: -0.02em; }
  .readme h3 { font-size: 17px; font-weight: 450; line-height: 1.5; margin: 32px 0 16px; }
  .readme ul, .readme ol { padding-left: 24px; }
  .readme li + li { margin-top: 8px; }
  .readme a { color: inherit; overflow-wrap: anywhere; }
  .readme a:hover, .project-meta a:hover { color: #787878; }
  .readme strong { font-weight: 550; }
  .readme code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
  .readme :not(pre) > code { overflow-wrap: anywhere; }
  .readme pre { max-width: 100%; overflow-x: auto; padding: 16px; margin-block: 28px; background: #121210; border: 1px solid #252522; line-height: 1.7; font-size: 13px; }
  .readme pre code { font-size: inherit; }
  .readme .table-scroll { max-width: 100%; overflow-x: auto; margin-block: 28px; }
  .readme table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .readme th, .readme td { padding: 8px 12px; border-bottom: 1px solid #252522; text-align: left; vertical-align: top; }
  .readme figure { margin-block: 32px; }
  .readme picture { display: block; }
  .readme img { display: block; max-width: 100%; height: auto; }
  .readme figcaption { color: #8a8a8a; font-size: 13px; margin-top: 12px; }
"""


def readable_date(value):
    day = date.fromisoformat(value)
    return f"{day.strftime('%b').lower()} {day.day}, {day.year}"


def pandoc(source, source_format, target_format):
    return subprocess.check_output(
        ["pandoc", "--from", source_format, "--to", target_format,
         "--syntax-highlighting=none"],
        input=source, text=True,
    )


def prepare_ast(node, project, image_state):
    if isinstance(node, dict):
        kind = node.get("t")
        if kind in {"Link", "Image"}:
            attributes, _, target = node["c"]
            url = target[0]
            if kind == "Image":
                first_image = not image_state["seen"]
                image_state["seen"] = True
                target[0] = project["images"][url]
                image = ROOT / target[0].lstrip("/")
                width, height = struct.unpack(">II", image.read_bytes()[16:24])
                attributes[2].extend([
                    ["width", str(width)], ["height", str(height)],
                    ["loading", "eager" if first_image else "lazy"],
                    ["decoding", "async"],
                ])
                # The opening plot is visible in the initial reading viewport.
                if first_image:
                    attributes[2].append(["fetchpriority", "high"])
            elif not urlsplit(url).scheme and not url.startswith("#"):
                if not project.get("source_commit"):
                    raise ValueError(f"relative link requires a source commit: {url}")
                base = (f"https://github.com/adhikrysh/{project['slug']}/"
                        f"blob/{project['source_commit']}/")
                target[0] = urljoin(base, url)
            if kind == "Link" and urlsplit(target[0]).scheme == "https":
                attributes[2].extend([
                    ["target", "_blank"], ["rel", "noopener noreferrer"],
                ])
        for value in node.values():
            prepare_ast(value, project, image_state)
    elif isinstance(node, list):
        for value in node:
            prepare_ast(value, project, image_state)


index_path = ROOT / "projects.html"
index = index_path.read_text()
if any(project["group"] not in dict(GROUPS) for project in PROJECTS):
    raise ValueError("unknown project group")
sections = []
for group, label in GROUPS:
    items = []
    projects = sorted((p for p in PROJECTS if p["group"] == group),
                      key=lambda p: p.get("date", ""), reverse=True)
    for project in projects:
        slug = project["slug"]
        title = html.escape(project.get("title", slug))
        timestamp = (f'<time datetime="{project["date"]}">{readable_date(project["date"])}</time>'
                     if project.get("date") else "")
        items.append(f'''            <li>
              <a href="/src/{slug}"><span>{title}</span>{timestamp}</a>
              <p>{html.escape(project['description'])}</p>
            </li>''')
    sections.append(f'''        <section class="project-group" aria-labelledby="{group}">
          <h2 id="{group}">{label}</h2>
          <ul class="project-list" aria-label="{label}">
{chr(10).join(items)}
          </ul>
        </section>''')
index, count = re.subn(
    r'<!-- project-index:start -->.*?<!-- project-index:end -->',
    lambda _: '<!-- project-index:start -->\n      <div class="project-index">\n'
    + "\n".join(sections) + '\n      </div>\n      <!-- project-index:end -->',
    index, flags=re.DOTALL,
)
if count != 1:
    raise ValueError("project index must have exactly one pair of markers")
index_path.write_text(index)
(ROOT / "src.html").write_text(index)

for project in PROJECTS:
    slug = project["slug"]
    markdown = (ROOT / "content/projects" / f"{slug}.md").read_text()
    ast = json.loads(pandoc(markdown, "gfm", "json"))
    if ast["blocks"] and ast["blocks"][0]["t"] == "Header" and ast["blocks"][0]["c"][0] == 1:
        ast["blocks"].pop(0)
    prepare_ast(ast, project, {"seen": False})
    body = pandoc(json.dumps(ast), "json", "html5")
    body = re.sub(r'(<table>.*?</table>)',
                  r'<div class="table-scroll" tabindex="0">\1</div>',
                  body, flags=re.DOTALL)
    # Keep the original PNG as a fallback; modern browsers download only the lossless WebP.
    def picture(match):
        webp = project.get("webp_images", {}).get(match[2])
        if not webp:
            return match[1]
        return (f'<picture><source srcset="{html.escape(webp, quote=True)}" '
                f'type="image/webp">{match[1]}</picture>')
    body = re.sub(r'(<img src="([^"]+)"[^>]*>)', picture, body)
    head = index.split("</head>")[0]
    head = re.sub(r'^  \.(?:project-list|project-index|project-group)[^\n]*\n',
                  '', head, flags=re.MULTILINE)
    title = html.escape(project.get("title", slug))
    head = head.replace("things i've built | adhikrish rk", f"{title} | adhikrish rk")
    head = head.replace(INDEX_DESCRIPTION,
                        html.escape(project["description"], quote=True))
    head = head.replace('content="website"', 'content="article"')
    head = head.replace('href="https://adhikrish.cloud/src"',
                        f'href="https://adhikrish.cloud/src/{slug}"')
    head = head.replace("</style>", READING_CSS + "</style>")
    repository = f"https://github.com/adhikrysh/{slug}" if project.get("source_commit") else None
    external_url = repository or project.get("website")
    external_label = "github" if repository else f"visit {slug}"
    external_link = (f'      <a class="external" href="{html.escape(external_url, quote=True)}" '
                     f'target="_blank" rel="noopener noreferrer" '
                     f'aria-label="{external_label} (opens in a new tab)" '
                     f'title="opens in a new tab">{external_label}</a>' if external_url else "")
    metadata = ""
    if project.get("date"):
        metadata = f'''      <p class="project-meta">
        <a href="{repository}/commit/{project['first_commit']}" target="_blank" rel="noopener noreferrer"><time datetime="{project['date']}">{readable_date(project['date'])}</time></a>
        <span class="last-edited">last edited <a href="{repository}/commit/{project['source_commit']}" target="_blank" rel="noopener noreferrer"><time datetime="{project['edited_date']}">{readable_date(project['edited_date'])}</time></a></span>
      </p>
'''
    page = head + f'''</head>
<body>
  <div class="reading">
    <nav aria-label="site">
      <a href="/">home</a>
      <a href="/src">things i've built</a>
{external_link}
    </nav>
    <main class="project">
      <h1>{title}</h1>
{metadata}      <div class="readme">
{body}      </div>
    </main>
  </div>
</body>
</html>
'''
    for directory in ("src", "projects"):
        output = ROOT / directory / f"{slug}.html"
        output.parent.mkdir(exist_ok=True)
        output.write_text(page)
    print(f"rendered src/{slug}.html")
