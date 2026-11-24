// Garmin's official Personal API, as the sync uses it: the key (a worker secret, made in garmin connect web, valid up to a
// year) buys a 24-hour bearer token, which reads every GET endpoint. The api is read-only: nothing here can write to garmin.
// Plus the small converters every mapping shares.
export type GarminEnv = { DB: D1Database; GARMIN_API_KEY?: string; GARMIN_URL?: string };

export const DAY = 86_400_000;
export const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(Date.parse(`${d}T00:00:00Z`) + n * DAY);
export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const mins = (v: unknown, per = 60) => (num(v) === undefined ? undefined : Math.round((v as number) / per));
export const round = (v: unknown, places = 1) => (num(v) === undefined ? undefined : Math.round((v as number) * 10 ** places) / 10 ** places);
/** garmin's codes as words: "POSITIVE_OPTIMAL_STRUCTURE" -> "positive optimal structure"; "NONE" and variant numbers dropped */
export const words = (v: unknown) => (typeof v === "string" && v && v !== "NONE" ? v.replace(/_\d+$/, "").toLowerCase().replaceAll("_", " ") : undefined);
/** a garmin "local" epoch (local wall time written as if utc) as "2026-11-21T23:39" */
export const wall = (v: unknown) => (num(v) === undefined ? undefined : new Date(v as number).toISOString().slice(0, 16));
/** minutes from local midnight of `date`, for garmin's "local" timestamps ("2026-11-21T23:43:12.0" on the 22nd → -17) */
export const localMinute = (date: string, local: string) => Math.round((Date.parse(`${local.slice(0, 19)}Z`) - Date.parse(`${date}T00:00:00Z`)) / 60_000);

export class Garmin {
  calls = 0;
  constructor(private base: string, private token: string) {}
  static async connect(env: GarminEnv): Promise<Garmin> {
    const base = env.GARMIN_URL || "https://personal.connectapi.garmin.com";
    const r = await fetch(`${base}/personalapitoken-service/personal-api/personal-api-key/token`, { method: "POST", headers: { Accept: "*/*", Authorization: `ApiKey ${env.GARMIN_API_KEY}` } });
    if (!r.ok) throw new Error(`garmin token: ${r.status}`);
    const g = new Garmin(base, (await r.text()).trim());
    g.calls = 1;
    return g;
  }
  /** GET a path; an error status or a body that isn't json reads as nothing, so one missing endpoint never sinks the run. */
  async get(path: string): Promise<any> {
    this.calls++;
    const r = await fetch(`${this.base}${path}`, { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" } });
    if (!r.ok) { console.log(`garmin ${r.status} ${path.split("?")[0]}`); return null; }
    return r.json().catch(() => null);
  }
}
