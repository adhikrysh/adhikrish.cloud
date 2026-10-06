#!/usr/bin/env python3
"""Render the checked-in project readmes. Requires Python 3 and Pandoc."""

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
READING_CSS = """
  nav { flex-wrap: wrap; }
  nav .github { margin-left: auto; }
  .project h1 { font-size: 28px; }
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


def prepare_ast(node, project):
    if isinstance(node, dict):
        kind = node.get("t")
        if kind in {"Link", "Image"}:
            attributes, _, target = node["c"]
            url = target[0]
            if kind == "Image":
                target[0] = project["images"][url]
                image = ROOT / target[0].lstrip("/")
                width, height = struct.unpack(">II", image.read_bytes()[16:24])
                attributes[2].extend([
                    ["width", str(width)], ["height", str(height)],
                    ["loading", "lazy"], ["decoding", "async"],
                ])
            elif not urlsplit(url).scheme and not url.startswith("#"):
                base = (f"https://github.com/adhikrysh/{project['slug']}/"
                        f"blob/{project['source_commit']}/")
                target[0] = urljoin(base, url)
            if kind == "Link" and urlsplit(target[0]).scheme == "https":
                attributes[2].extend([
                    ["target", "_blank"], ["rel", "noopener noreferrer"],
                ])
        for value in node.values():
            prepare_ast(value, project)
    elif isinstance(node, list):
        for value in node:
            prepare_ast(value, project)


index_path = ROOT / "projects.html"
index = index_path.read_text()
items = []
for project in sorted(PROJECTS, key=lambda p: p["date"], reverse=True):
    slug = project["slug"]
    items.append(f'''        <li>
          <a href="/projects/{slug}"><span>{slug}</span><time datetime="{project['date']}">{readable_date(project['date'])}</time></a>
          <p>{html.escape(project['description'])}</p>
        </li>''')
index = re.sub(
    r'(<ul class="project-list" aria-label="projects, newest first">).*?(\s*</ul>)',
    lambda match: match[1] + "\n" + "\n".join(items) + match[2],
    index, flags=re.DOTALL,
)
index_path.write_text(index)

for project in PROJECTS:
    slug = project["slug"]
    markdown = (ROOT / "content/projects" / f"{slug}.md").read_text()
    ast = json.loads(pandoc(markdown, "gfm", "json"))
    if ast["blocks"] and ast["blocks"][0]["t"] == "Header" and ast["blocks"][0]["c"][0] == 1:
        ast["blocks"].pop(0)
    prepare_ast(ast, project)
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
    head = re.sub(r'^  \.project-list[^\n]*\n', '', head, flags=re.MULTILINE)
    head = head.replace("projects | adhikrish rk", f"{slug} | adhikrish rk")
    head = head.replace("personal projects in spacecraft simulation, scheduling, and developer tools.",
                        html.escape(project["description"], quote=True))
    head = head.replace('content="website"', 'content="article"')
    head = head.replace('href="https://adhikrish.cloud/projects"',
                        f'href="https://adhikrish.cloud/projects/{slug}"')
    head = head.replace("</style>", READING_CSS + "</style>")
    repository = f"https://github.com/adhikrysh/{slug}"
    page = head + f'''</head>
<body>
  <div class="reading">
    <nav aria-label="site">
      <a href="/">home</a>
      <a href="/projects">projects</a>
      <a class="github" href="{repository}" target="_blank" rel="noopener noreferrer" aria-label="github (opens in a new tab)" title="opens in a new tab">github</a>
    </nav>
    <main class="project">
      <h1>{slug}</h1>
      <p class="project-meta">
        <a href="{repository}/commit/{project['first_commit']}" target="_blank" rel="noopener noreferrer"><time datetime="{project['date']}">{readable_date(project['date'])}</time></a>
        <span class="last-edited">last edited <a href="{repository}/commit/{project['source_commit']}" target="_blank" rel="noopener noreferrer"><time datetime="{project['edited_date']}">{readable_date(project['edited_date'])}</time></a></span>
      </p>
      <div class="readme">
{body}      </div>
    </main>
  </div>
</body>
</html>
'''
    output = ROOT / "projects" / f"{slug}.html"
    output.parent.mkdir(exist_ok=True)
    output.write_text(page)
    print(f"rendered {output.relative_to(ROOT)}")
