// The dashboard: every service, whether it answered just now, and how fast.
import { escape, page } from "../../../design/html.ts";
import base from "../../../design/base.css?raw";
import list from "../../../design/list.css?raw";
import type { ProbeResult, Service } from "./probe.ts";

const CSS = `
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 10px; vertical-align: 1px; }
  .dot.up { background: #6f9e6a; }
  .dot.down { background: #c4553f; }
  .project-list small.down { color: #c4553f; }
  h2 { font-size: 15px; font-weight: 450; color: #8a8a8a; margin-top: 48px; }
`;

export function render(services: Service[], results: ProbeResult[], external: Service[]): string {
  const items = services.map((service, i) => {
    const r = results[i];
    const note = r.up ? `<small>${r.ms} ms</small>` : `<small class="down">${escape(r.error)}</small>`;
    const about = service.about ? `\n            <p>${escape(service.about)}</p>` : "";
    return `          <li>
            <a href="${escape(service.url)}"><span><i class="dot ${r.up ? "up" : "down"}"></i>${escape(service.name)}</span>${note}</a>${about}
          </li>`;
  });
  const links = external.map((s) => `          <li><a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer"><span>${escape(s.name)}</span></a></li>`);
  const body = `      <h1>admin</h1>
      <ul class="project-list">
${items.join("\n")}
      </ul>
      <h2>elsewhere</h2>
      <ul class="project-list">
${links.join("\n")}
      </ul>`;
  const nav = `<a href="https://adhikrish.cloud/">adhikrish.cloud</a><a href="https://snrintern.adhikrish.cloud/">snrintern</a>`;
  return page({ design: { base, list }, title: "admin", nav, body, css: CSS });
}
