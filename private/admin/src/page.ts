// The dashboard: every service, whether its last probe (at most 5 minutes old) answered, how fast, and its last 24 hours.
import { escape, page } from "../../../design/html.ts";
import base from "../../../design/base.css?raw";
import list from "../../../design/list.css?raw";
import type { ProbeResult, Service } from "./probe.ts";

export type Uptime = { ticks: (boolean | null)[]; ratio: number | null };
export type Group = [title: string, services: Service[], results: ProbeResult[]];

const CSS = `
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 10px; vertical-align: 1px; }
  .dot.up { background: var(--good); }
  .dot.down { background: var(--bad); }
  h2 { margin-top: 48px; line-height: 1; }
  h1 + h2 { margin-top: 36px; }
  .project-list { margin-top: 18px; }
  .project-list li + li { margin-top: 22px; }
  .uptime { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-size: var(--fs-tiny); color: var(--faint); }
  .ticks { display: flex; gap: 2px; }
  .ticks i { width: 6px; height: 14px; border-radius: 2px; background: var(--line); }
  .ticks i.up { background: var(--good); } .ticks i.down { background: var(--bad); }
`;

/** 24 hourly ticks (green: every probe up, red: any down, dark: no data yet) and the 30-day uptime. */
function strip(u: Uptime | undefined): string {
  if (!u) return "";
  const ticks = u.ticks.map((t) => `<i class="${t === null ? "" : t ? "up" : "down"}"></i>`).join("");
  const ratio = u.ratio === null ? "" : `<span>${Number((u.ratio * 100).toFixed(2))}%</span>`;
  return `<p class="uptime"><span class="ticks" title="last 24 hours">${ticks}</span>${ratio}</p>`;
}

function items(services: Service[], results: ProbeResult[], history: Map<string, Uptime>): string {
  return services.map((service, i) => {
    const r = results[i];
    const note = r.up ? (r.ms === null ? "" : `<small>${r.ms} ms</small>`) : `<small class="bad">${escape(r.error)}</small>`;
    const about = service.about ? `\n            <p>${escape(service.about)}</p>` : "";
    return `          <li>
            <a href="${escape(service.url)}"><span><i class="dot ${r.up ? "up" : "down"}"></i>${escape(service.name)}</span>${note}</a>${about}
            ${strip(history.get(service.name))}
          </li>`;
  }).join("\n");
}

export function render(groups: Group[], history: Map<string, Uptime>): string {
  const sections = groups.map(([title, services, results]) => `      <h2><span class="pill">${escape(title)}</span></h2>
      <ul class="project-list">
${items(services, results, history)}
      </ul>`);
  const body = `      <h1>uptime</h1>
${sections.join("\n")}`;
  return page({ design: { base, list }, title: "uptime", nav: "", body, css: CSS });
}
