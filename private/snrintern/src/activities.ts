// Garmin activities and weigh-ins, merged with what the agent logs. Either side alone is a real session (or weigh-in); when both
// have it, they become one row.
//   who owns what   garmin owns what the watch measures: the start (`at`), duration, distance, heart rate, load, training
//                   effect, splits. the agent owns what only you can say: focus, lifts, rpe, notes. type and title are the
//                   agent's, but garmin fills them on a row that has none, so a run you never mentioned still reads "run".
//                   neither side ever overwrites the other's fields.
//   the same        a garmin activity and an agent row are one session when they start within 2 hours of each other on the
//   session         same local day (an agent row with only a date matches on the date, after any timed one). the type
//                   doesn't have to agree: the agent may call a hike a walk. when several could pair, the closest starts
//                   pair first, so two hikes in one morning stay two rows.
//   both ways       the sync merges an activity into the agent's row (sync below); an agent POST merges into a row garmin
//                   made that the agent hasn't written to yet (claim below).
//   the one delete  an activity you delete in garmin takes its row with it, unless the agent wrote to that row; then the row
//                   stays and only loses its link to garmin.
// The watch's raw files (FIT) are never stored: every number worth keeping is in garmin's summaries.
import * as db from "./db.ts";
import { type Garmin, num, round, wall, words } from "./garmin-client.ts";
import { checkRow, type Data, type Tab } from "./schema.ts";

export const TRAINING = "training";
export const BODY = "body";
const BY = "garmin";
const WINDOW = 2 * 3_600_000; // how far apart two starts can be and still be one session
const AGENT_ONLY = ["focus", "lifts", "rpe", "notes"]; // a row with any of these has been written to by the agent
const FILLS = ["type", "title"]; // the agent's, but garmin fills them when a row lacks them
export const RECENT = 20; // activities listed when checking for new ones
export const PAGE = 100; // most activities listed in one backfill call

type Activity = Record<string, any>;
export const hasAgent = (row: Data) => AGENT_ONLY.some((k) => row[k] !== undefined && row[k] !== null && row[k] !== "");

/** garmin's activity type ("trail_running", "lap_swimming") as one of the training tab's types */
export function sport(key: string): string {
  if (/run/.test(key)) return "run";
  if (/swim/.test(key)) return "swim";
  if (/cycl|bik|ride/.test(key)) return "ride";
  if (/hik/.test(key)) return "hike";
  if (/climb|boulder/.test(key)) return "climb";
  if (/strength/.test(key)) return "strength";
  if (/soccer|football|tennis|basketball|volleyball|badminton|squash|pickleball|padel|golf|hockey|rugby|cricket|baseball|softball|ultimate/.test(key)) return "sport";
  return "other";
}

/** an offset in minutes as "-07:00" */
const offset = (m: number) => `${m < 0 ? "-" : "+"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;

/** garmin's local and gmt wall times ("2026-10-10 10:05:33", "2026-10-10 17:05:33") as an `at` with its offset, its instant,
 * and its local day */
export function startOf(local: unknown, gmt: unknown): { at: string; t: number; date: string } | null {
  if (typeof local !== "string" || typeof gmt !== "string") return null;
  const l = Date.parse(`${local.slice(0, 19).replace(" ", "T")}Z`), t = Date.parse(`${gmt.slice(0, 19).replace(" ", "T")}Z`);
  if (!Number.isFinite(l) || !Number.isFinite(t)) return null;
  const at = `${new Date(l).toISOString().slice(0, 16)}${offset(Math.round((l - t) / 60_000))}`;
  return { at, t, date: at.slice(0, 10) };
}

const whole = (v: unknown) => round(v, 0);
const minutes = (seconds: unknown) => (num(seconds) === undefined ? undefined : Math.round((seconds as number) / 60));
const positive = (v: number | undefined) => (v !== undefined && v > 0 ? v : undefined);
/** watch feel, 0 to 100 in steps of 25, as garmin's words */
const FEEL = ["very weak", "weak", "normal", "strong", "very strong"];

/** One listed activity as training fields: everything garmin owns, plus a type and title for when the row has none. */
export function fromList(a: Activity): Data | null {
  const start = startOf(a.startTimeLocal, a.startTimeGMT);
  if (!start || num(a.activityId) === undefined) return null;
  const key = String(a.activityType?.typeKey ?? "other");
  const km = positive(round((a.distance ?? NaN) / 1000, 2));
  const mod = num(a.moderateIntensityMinutes), vig = num(a.vigorousIntensityMinutes);
  const out: Record<string, unknown> = {
    at: start.at, garmin_id: a.activityId, garmin_type: words(key), type: sport(key),
    title: typeof a.activityName === "string" && a.activityName.trim() ? a.activityName.trim().toLowerCase() : words(key),
    duration_min: minutes(a.duration), moving_min: km ? minutes(a.movingDuration) : undefined, distance_km: km,
    elevation_m: km ? whole(a.elevationGain) : undefined, avg_hr: whole(a.averageHR), max_hr: whole(a.maxHR), calories: whole(a.calories),
    training_load: whole(a.activityTrainingLoad), aerobic_effect: round(a.aerobicTrainingEffect), anaerobic_effect: round(a.anaerobicTrainingEffect),
    training_effect: words(a.trainingEffectLabel), effect_feedback: words(a.aerobicTrainingEffectMessage),
    intensity_min: mod === undefined && vig === undefined ? undefined : (mod ?? 0) + 2 * (vig ?? 0), // garmin's count: vigorous counts double
    body_battery_change: whole(a.differenceBodyBattery), avg_power: positive(whole(a.avgPower)),
    avg_cadence: positive(whole(a.averageRunningCadenceInStepsPerMinute)),
    fastest_1k_s: whole(a.fastestSplit_1000), fastest_5k_s: whole(a.fastestSplit_5000), fastest_10k_s: whole(a.fastestSplit_10000),
  };
  for (let z = 1; z <= 5; z++) out[`hr_zone_${z}_min`] = minutes(a[`hrTimeInZone_${z}`]);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== null)) as Data;
}

/** The detail call's extras: what you told the watch after (perceived effort, how you felt) and stamina at the start and end. */
export function fromDetail(d: any): Data {
  const s = d?.summaryDTO ?? {}, out: Data = {};
  const rpe = num(s.directWorkoutRpe), feel = num(s.directWorkoutFeel);
  if (rpe !== undefined && rpe >= 10) out.watch_rpe = Math.min(10, Math.round(rpe / 10)); // garmin keeps 10 to 100
  if (feel !== undefined) out.watch_feel = FEEL[Math.min(4, Math.max(0, Math.round(feel / 25)))];
  const s0 = whole(s.beginPotentialStamina), s1 = whole(s.endPotentialStamina);
  if (s0 !== undefined) out.stamina_start = s0;
  if (s1 !== undefined) out.stamina_end = s1;
  return out;
}

/** Only the fields the tab knows (a definition without, say, avg_power just doesn't get it), checked like any write. */
function known(tab: Tab, data: Data, partial: boolean): Data | null {
  const kept = Object.fromEntries(Object.entries(data).filter(([k]) => tab.fields.some((f) => f.name === k)));
  const checked = checkRow(tab, kept, { partial });
  if (typeof checked === "string") { console.log(`garmin ${tab.slug} ${data.garmin_id}: ${checked}`); return null; }
  return checked.set;
}

/** What garmin writes onto a row that already exists: its own fields, and type and title only where the row has none. */
const patchFor = (row: Data, data: Data): Data =>
  Object.fromEntries(Object.entries(data).filter(([k]) => !FILLS.includes(k) || row[k] === undefined || row[k] === null || row[k] === ""));

type Entry = { id?: number; data: Data; t: number | null; date: string };
const instant = (at: unknown) => (typeof at === "string" && at.length > 10 ? Date.parse(at) : NaN);

/** A tab's rows as the sync sees them, loaded once a run: every merge and insert updates this copy, so a session matched by
 * the recent check is already linked when the backfill sees it again. Writes are collected and sent in one batch. */
export class Book {
  writes: D1PreparedStatement[] = [];
  private constructor(private database: D1Database, private tab: Tab, private entries: Entry[]) {}

  static async load(database: D1Database, slug: string): Promise<Book | null> {
    const tab = await db.tab(database, slug);
    if (!tab) return null;
    const rows = await db.list(database, tab);
    return new Book(database, tab, rows.map((r) => ({ id: r.id, data: r, t: Number.isFinite(instant(r.at)) ? instant(r.at) : null, date: String(r.at ?? "").slice(0, 10) })));
  }

  has(garminId: number) { return this.entries.some((e) => e.data.garmin_id === garminId); }

  /** Merges garmin's records in: each into the row linked to it, else the closest unlinked row that is the same session,
   * else a new row. Returns how many new rows. */
  add(records: Data[]): number {
    const pending: { data: Data; t: number; date: string }[] = [];
    for (const data of records) {
      const t = instant(data.at), date = String(data.at).slice(0, 10);
      const linked = this.entries.find((e) => e.data.garmin_id === data.garmin_id);
      if (linked) this.merge(linked, data);
      else pending.push({ data, t, date });
    }
    // every possible pairing, closest first; a timed row beats a date-only one
    const pairs: { p: number; e: Entry; gap: number }[] = [];
    pending.forEach((p, i) => {
      for (const e of this.entries) {
        if (e.data.garmin_id !== undefined || e.date !== p.date) continue;
        const gap = e.t === null ? WINDOW + 1 : Math.abs(e.t - p.t);
        if (e.t === null || gap <= WINDOW) pairs.push({ p: i, e, gap });
      }
    });
    pairs.sort((a, b) => a.gap - b.gap);
    const placed = new Set<number>();
    for (const { p, e } of pairs) {
      if (placed.has(p) || e.data.garmin_id !== undefined) continue;
      placed.add(p);
      this.merge(e, pending[p].data);
    }
    let inserted = 0;
    pending.forEach((p, i) => {
      if (placed.has(i)) return;
      const data = known(this.tab, p.data, false);
      if (!data) return;
      this.writes.push(db.insertStatement(this.database, this.tab.slug, data, BY));
      this.entries.push({ data, t: p.t, date: p.date });
      inserted++;
    });
    return inserted;
  }

  private merge(e: Entry, data: Data) {
    if (e.id === undefined) return; // inserted earlier this run (the backfill re-listing what the recent check just added)
    const patch = known(this.tab, patchFor(e.data, data), true);
    if (!patch || !Object.keys(patch).length) return;
    this.writes.push(db.mergeInto(this.database, e.id, patch, BY));
    Object.assign(e.data, patch);
    e.t = instant(e.data.at);
    e.date = String(e.data.at).slice(0, 10);
  }

  /** After listing the newest activities: a linked row inside the listed span whose activity is gone was deleted in garmin.
   * It goes, unless the agent wrote to it; then it only loses its link. */
  prune(listed: Data[]) {
    const times = listed.map((d) => instant(d.at)).filter(Number.isFinite);
    if (!times.length) return;
    const from = Math.min(...times), ids = new Set(listed.map((d) => d.garmin_id));
    for (const e of this.entries) {
      if (e.id === undefined || e.data.garmin_id === undefined || ids.has(e.data.garmin_id) || e.t === null || e.t < from) continue;
      this.writes.push(hasAgent(e.data) ? db.unsetStatement(this.database, e.id, "garmin_id", BY) : db.deleteStatement(this.database, e.id));
      delete e.data.garmin_id;
    }
  }
}

/** Lists activities (newest first, from `start`) and maps them, fetching each new one's detail: 1 call plus 1 per new
 * activity. `null` when the listing failed. */
export async function fetchActivities(g: Garmin, book: Book, start: number, limit: number): Promise<Data[] | null> {
  const list = await g.get(`/activitylist-service/activities/search/activities?start=${start}&limit=${limit}`);
  if (!Array.isArray(list)) return null;
  const records: Data[] = [];
  for (const a of list) {
    const data = fromList(a);
    if (!data) continue;
    if (!book.has(Number(data.garmin_id))) Object.assign(data, fromDetail(await g.get(`/activity-service/activity/${data.garmin_id}`)));
    records.push(data);
  }
  return records;
}

/** garmin's weigh-ins (the weight range call's daily summaries) as body rows: the day's latest weigh-in. */
export function weighIns(weight: any): Data[] {
  const out: Data[] = [];
  for (const w of weight?.dailyWeightSummaries ?? []) {
    const l = w?.latestWeight ?? {}, kg = round((l.weight ?? NaN) / 1000);
    if (kg === undefined || typeof w.summaryDate !== "string" || num(l.samplePk) === undefined) continue;
    const local = num(l.date), gmt = num(l.timestampGMT);
    const at = local !== undefined && gmt !== undefined ? `${wall(local)}${offset(Math.round((local - gmt) / 60_000))}` : w.summaryDate;
    const row: Data = { at, garmin_id: l.samplePk, bodyweight_kg: kg };
    const fat = round(l.bodyFat);
    if (fat !== undefined) row.bodyfat_percentage = fat;
    out.push(row);
  }
  return out;
}

/** An agent's new training session that is a garmin activity already stored: merged into that row, instead of a second row.
 * The agent's own fields (and type and title) land; measurements garmin already has stay garmin's. */
export async function claim(database: D1Database, tab: Tab, data: Data, who: string): Promise<db.Row | null> {
  const t = instant(data.at);
  if (!Number.isFinite(t)) return null;
  const candidates = (await db.sameDay(database, tab.slug, "at", String(data.at).slice(0, 10)))
    .filter((r) => r.garmin_id !== undefined && !hasAgent(r) && Math.abs(instant(r.at) - t) <= WINDOW)
    .sort((a, b) => Math.abs(instant(a.at) - t) - Math.abs(instant(b.at) - t));
  const row = candidates[0];
  if (!row) return null;
  const set = Object.fromEntries(Object.entries(data).filter(([k]) => AGENT_ONLY.includes(k) || FILLS.includes(k) || row[k] === undefined));
  return db.update(database, tab.slug, row.id, { set, unset: [] }, who);
}
