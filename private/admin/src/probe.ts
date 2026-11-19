// Probes one service. Most go the way a visitor does: cloudflare edge -> access -> tunnel -> app. A service with a
// `binding` runs on cloudflare too and is called directly through that service binding, skipping access and the edge.
import services from "../../../services.json";

export type Service = { name: string; url: string; health?: string; binding?: string; about?: string };
export type ProbeResult = { service: string; at: number; up: boolean; status: number | null; ms: number | null; error: string | null; colo?: string | null };

/** The cloudflare data center this code is running in, by its airport code (SIN, SJC, ...). A worker's request from a
 * service binding or a timer carries no location of its own, so ask cloudflare's trace endpoint, which names the data
 * center the request left from. Not timed, and run beside the probes. */
export async function here(): Promise<string | null> {
  try {
    const text = await (await fetch("https://adhikrish.cloud/cdn-cgi/trace", { signal: AbortSignal.timeout(3_000) })).text();
    return /^colo=(\w+)$/m.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
}

export const publicSites: Service[] = services.public;
export const privateSites: Service[] = services.private;

// Short enough that the page never hangs: a slow service shows as down.
const TIMEOUT_MS = 5_000;

/** `token` is the prober's access service token; pass null where nothing checks it (the public site, a binding). */
export async function probe(service: Service, token: { id: string; secret: string } | null, bindings: Record<string, Fetcher>): Promise<ProbeResult> {
  const at = Date.now();
  try {
    const target = service.binding ? bindings[service.binding] : undefined;
    if (service.binding && !target) throw new Error(`no binding ${service.binding}`);
    const send = (url: string, init: RequestInit) => (target ? target.fetch(new URL("/health", url).href, init) : fetch(url, init));
    const response = await send(service.health ?? service.url, {
      // Never follow redirects: a redirect to the access login means the probe was refused.
      redirect: "manual",
      headers: token ? { "CF-Access-Client-Id": token.id, "CF-Access-Client-Secret": token.secret } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - at;
    const location = response.headers.get("location") ?? "";
    if (location.includes(".cloudflareaccess.com")) {
      return { service: service.name, at, up: false, status: response.status, ms, error: "access refused the probe token" };
    }
    // 502/503/504 from the proxy, 530 when cloudflare cannot reach the tunnel.
    if (response.status >= 500) {
      const error = response.status === 530 ? "tunnel unreachable" : `server error ${response.status}`;
      return { service: service.name, at, up: false, status: response.status, ms, error };
    }
    // A cloudflare worker reports its own numbers: how long its database query took, measured inside it, and where it ran
    // (cf-placement, e.g. "remote-SJC"). Its own time doesn't depend on where this probe started.
    if (target) {
      const report = (await response.json().catch(() => ({}))) as { ms?: number; ran?: string | null };
      return { service: service.name, at, up: true, status: response.status, ms: report.ms ?? ms, error: null, colo: report.ran ?? null };
    }
    return { service: service.name, at, up: true, status: response.status, ms, error: null };
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return { service: service.name, at, up: false, status: null, ms: null, error: timedOut ? `no answer in ${TIMEOUT_MS / 1000}s` : "request failed" };
  }
}
