// The dashboard: every service, whether its last probe (at most 5 minutes old) answered, how fast, and its last 24 hours.
import { escape, page } from "../../../design/html.ts";
import base from "../../../design/base.css?raw";
import list from "../../../design/list.css?raw";
import { publicSites, type ProbeResult, type Service } from "./probe.ts";

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
  /* Where the number was measured from: hidden until the row is hovered or tapped, so the page stays quiet. */
  /* Where the number was measured: a faint label beside it, shown while the row is hovered or tapped. */
  .origin { margin-left: 10px; color: var(--faint); font-size: var(--fs-tiny); opacity: 0; transition: opacity .15s; white-space: nowrap; }
  li:hover .origin, li:focus-within .origin { opacity: 1; }
  .ticks { display: flex; gap: 2px; }
  .ticks i { width: 6px; height: 14px; border-radius: 2px; background: var(--line); }
  .ticks i.up { background: var(--good); } .ticks i.down { background: var(--bad); }
`;

/** 24 hourly ticks (green: every probe up, red: any down, dark: no data yet) and the 30-day uptime. */
function strip(u: Uptime | undefined): string {
  if (!u) return "";
  const ticks = u.ticks.map((t) => `<i class="${t === null ? "" : t ? "up" : "down"}"></i>`).join("");
  const ratio = u.ratio === null ? "" : `<span>${Number((u.ratio * 100).toFixed(2))}%</span>`;
  return `<p class="uptime"><span class="ticks">${ticks}</span>${ratio}</p>`;
}

// Cloudflare names its data centers by the nearest airport's code. The ones probes have run from so far, plus neighbours.
const CITY: Record<string, string> = {
  SIN: "singapore", SJC: "san jose", SFO: "san francisco", LAX: "los angeles", SEA: "seattle", PDX: "portland",
  ATL: "atlanta", WAW: "warsaw", AMS: "amsterdam", CDG: "paris", IAD: "ashburn", EWR: "newark", ORD: "chicago", DFW: "dallas", HKG: "hong kong", NRT: "tokyo", FRA: "frankfurt", LHR: "london",
};
const place = (colo: string | null) => {
  const code = colo?.replace(/^(remote|local)-/, "") ?? null;
  return code ? `${CITY[code] ?? code} (${code})` : "an unrecorded data center";
};

/** The hover note: just where the number was measured. See docs/uptime-probes.md for the roads behind it. */
const origin = (colo: string | null) => `measured from ${place(colo)}`;

function items(services: Service[], results: ProbeResult[], history: Map<string, Uptime>): string {
  return services.map((service, i) => {
    const r = results[i];
    const where = escape(origin(r.colo ?? null));
    const tip = `<span class="origin">${where}</span>`;
    const note = r.up ? (r.ms === null ? "" : `<small>${r.ms} ms${tip}</small>`) : `<small class="bad">${escape(r.error)}${tip}</small>`;
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
  return page({ design: { base, list }, title: "uptime", nav: `<a class="back" href="https://adhikrish.cloud/" aria-label="back to adhikrish.cloud">←</a>`, body, css: CSS });
}
