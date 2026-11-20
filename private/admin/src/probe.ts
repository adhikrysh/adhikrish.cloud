// Probes one service the way a visitor reaches it: cloudflare edge -> access -> the app. For a self-hosted app the road
// continues through the tunnel to the thinkpad; a `cloudflare` service is a worker that answers at the edge.
import services from "../../../services.json";

export type Service = { name: string; url: string; health?: string; cloudflare?: boolean; about?: string };
export type ProbeResult = { service: string; at: number; up: boolean; status: number | null; ms: number | null; error: string | null };

export const publicSites: Service[] = services.public;
export const privateSites: Service[] = services.private;

// Short enough that the page never hangs: a slow service shows as down.
const TIMEOUT_MS = 5_000;

/** `token` is the prober's access service token; pass null for the public site, which nothing guards. */
export async function probe(service: Service, token: { id: string; secret: string } | null): Promise<ProbeResult> {
  const at = Date.now();
  try {
    const response = await fetch(service.health ?? service.url, {
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
    // A cloudflare worker reports its own number: how long its database query took, measured inside it, where its
    // placement runs it. So the number doesn't depend on where this probe started.
    if (service.cloudflare) {
      const report = (await response.json().catch(() => ({}))) as { ms?: number };
      return { service: service.name, at, up: true, status: response.status, ms: report.ms ?? ms, error: null };
    }
    return { service: service.name, at, up: true, status: response.status, ms, error: null };
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return { service: service.name, at, up: false, status: null, ms: null, error: timedOut ? `no answer in ${TIMEOUT_MS / 1000}s` : "request failed" };
  }
}
