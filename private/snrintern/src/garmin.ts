// Garmin → the health tab, on an hourly cron trigger. Garmin's official Personal API: the key (a worker secret, made in garmin
// connect web, valid up to a year) buys a 24-hour bearer token, which reads the day endpoints.
//   every 3rd hour   recent days: the last few days' numbers (5 range calls), and today's and yesterday's detail.
//                    the watch only uploads when the phone syncs, so checking more often fetches the same data again.
//   every hour,      history, until it is all in: one 30-day chunk further back (until three empty months in a row), then
//   while owed       each day's own detail, newest first: heart rate every 2 min, overnight hrv, body battery (for days
//                    garmin still has them, about 4 months) and the day summary (sedentary time, body battery at wake).
// Each day is one health row (merged by date) plus its series row. Writes merge, so a field fetched once is never wiped by a
// later call that doesn't carry it. Free plan: at most 50 outside requests a run; a run stops spending at 48.
import * as db from "./db.ts";
import { checkRow, type Data, type Tab } from "./schema.ts";

export type GarminEnv = { DB: D1Database; GARMIN_API_KEY?: string; GARMIN_URL?: string };

const TAB = "health";
const BY = "garmin";
const CHUNK = 30; // days per range call: sleep summaries refuse more than 30
const INTRADAY_DAYS = 120; // garmin keeps 2-minute heart rate for about 4 months; older days come back empty
const BUDGET = 48; // outside requests per run; the free plan allows 50
const RECENT_EVERY = 3; // hours between checks of the recent days
const DAY = 86_400_000;

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(Date.parse(`${d}T00:00:00Z`) + n * DAY);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const mins = (v: unknown, per = 60) => (num(v) === undefined ? undefined : Math.round((v as number) / per));
const round = (v: unknown, places = 1) => (num(v) === undefined ? undefined : Math.round((v as number) * 10 ** places) / 10 ** places);
/** garmin's codes as words: "POSITIVE_OPTIMAL_STRUCTURE" -> "positive optimal structure"; "NONE" and variant numbers dropped */
const words = (v: unknown) => (typeof v === "string" && v && v !== "NONE" ? v.replace(/_\d+$/, "").toLowerCase().replaceAll("_", " ") : undefined);
/** a garmin "local" epoch (local wall time written as if utc) as "2026-11-21T23:39" */
const wall = (v: unknown) => (num(v) === undefined ? undefined : new Date(v as number).toISOString().slice(0, 16));
/** minutes from local midnight of `date`, for garmin's "local" timestamps ("2026-11-21T23:43:12.0" on the 22nd → -17) */
const localMinute = (date: string, local: string) => Math.round((Date.parse(`${local.slice(0, 19)}Z`) - Date.parse(`${date}T00:00:00Z`)) / 60_000);

class Garmin {
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

/** Every daily number garmin has for each day in [start, end]: five range calls, keyed by date. */
async function daily(g: Garmin, start: string, end: string): Promise<Map<string, Data>> {
  const [summaries, sleeps, hrv, vo2, weight] = await Promise.all([
    g.get(`/usersummary-service/v2/dailysummaries?startDate=${start}&endDate=${end}`),
    g.get(`/sleep-service/sleep/dailySleepSummariesByDate?startDate=${start}&endDate=${end}`),
    g.get(`/hrv-service/hrv/daily/${start}/${end}`),
    g.get(`/metrics-service/metrics/maxmet/daily/${start}/${end}`),
    g.get(`/weight-service/weight/range/${start}/${end}?includeAll=true`),
  ]);
  const days = new Map<string, Data>();
  const day = (date: unknown) => {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (!days.has(date)) days.set(date, { date });
    return days.get(date)!;
  };
  const put = (row: Data | null, values: Record<string, unknown>) => {
    if (row) for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null) row[k] = v as number | string;
  };
  for (const s of summaries?.data ?? []) {
    if (s.includesWellnessData === false) continue;
    const mod = num(s.intensityMinutes?.moderate), vig = num(s.intensityMinutes?.vigorous);
    put(day(s.calendarDate), {
      steps: num(s.movement?.steps?.value), step_goal: num(s.movement?.steps?.goal), intensity_goal: num(s.intensityMinutes?.goal), distance_km: round((s.movement?.steps?.distanceInMeters ?? NaN) / 1000),
      floors: round(s.movement?.floorsAscended?.value, 0),
      calories_total: round(s.calories?.burnedTotal, 0), calories_active: round(s.calories?.burnedActive, 0),
      resting_hr: num(s.heartRate?.restingValue), min_hr: num(s.heartRate?.minValue), max_hr: num(s.heartRate?.maxValue),
      intensity_moderate: mod, intensity_vigorous: vig,
      // garmin's own count: a vigorous minute is worth two
      intensity_min: mod === undefined && vig === undefined ? undefined : (mod ?? 0) + 2 * (vig ?? 0),
      stress_qualifier: words(s.stress?.qualifier), body_battery_feedback: words(s.bodyBattery?.endOfDayDynamicFeedbackEvent?.feedbackLongType),
      stress_avg: num(s.stress?.avgLevel) !== undefined && s.stress.avgLevel >= 0 ? s.stress.avgLevel : undefined,
      stress_max: num(s.stress?.maxLevel) !== undefined && s.stress.maxLevel >= 0 ? s.stress.maxLevel : undefined,
      stress_rest_min: mins(s.stress?.restDurationInMillis, 60_000), stress_low_min: mins(s.stress?.lowStressDurationInMillis, 60_000),
      stress_medium_min: mins(s.stress?.mediumStressDurationInMillis, 60_000), stress_high_min: mins(s.stress?.highStressDurationInMillis, 60_000),
      body_battery_high: num(s.bodyBattery?.maxValue), body_battery_low: num(s.bodyBattery?.minValue),
      body_battery_charged: num(s.bodyBattery?.chargedValue), body_battery_drained: num(s.bodyBattery?.drainedValue),
      respiration_avg: round(s.respiration?.avgValue), respiration_low: round(s.respiration?.minValue), respiration_high: round(s.respiration?.maxValue),
    });
  }
  for (const s of Array.isArray(sleeps) ? sleeps : []) {
    if (!num(s.sleepTimeSeconds)) continue;
    put(day(s.calendarDate), {
      sleep_min: mins(s.sleepTimeSeconds), sleep_deep_min: mins(s.deepSleepSeconds), sleep_light_min: mins(s.lightSleepSeconds),
      sleep_rem_min: mins(s.remSleepSeconds), sleep_awake_min: mins(s.awakeSleepSeconds),
      sleep_score: num(s.sleepScores?.overall?.value), sleep_score_label: words(s.sleepScores?.overall?.qualifierKey), sleep_need_min: num(s.sleepNeed?.actual), nap_min: mins(s.napTimeSeconds) || undefined,
      sleep_hr: round(s.avgHeartRate, 0), sleep_stress: round(s.avgSleepStress, 0),
      bedtime: wall(s.sleepStartTimestampLocal), wake_time: wall(s.sleepEndTimestampLocal),
      sleep_feedback: words(s.sleepScoreFeedback), sleep_insight: words(s.sleepScorePersonalizedInsight) ?? words(s.sleepScoreInsight),
      sleep_need_feedback: words(s.sleepNeed?.feedback),
    });
  }
  for (const h of hrv?.hrvSummaries ?? []) {
    put(day(h.calendarDate), {
      hrv_ms: num(h.lastNightAvg), hrv_weekly_ms: num(h.weeklyAvg), hrv_status: typeof h.status === "string" ? h.status.toLowerCase() : undefined,
      hrv_baseline_low: num(h.baseline?.balancedLow), hrv_baseline_high: num(h.baseline?.balancedUpper), hrv_feedback: words(h.feedbackPhrase),
    });
  }
  for (const v of Array.isArray(vo2) ? vo2 : []) put(day(v.calendarDate), { vo2max: round(v.generic?.vo2MaxPreciseValue ?? v.generic?.vo2MaxValue) });
  for (const w of weight?.dailyWeightSummaries ?? []) put(day(w.summaryDate), { weight_kg: round((w.latestWeight?.weight ?? NaN) / 1000) });
  // a day with only its date is a day the watch wasn't worn
  for (const [date, row] of days) if (Object.keys(row).length === 1) days.delete(date);
  return days;
}

/** The day summary's numbers that no range call carries: time sitting and active, body battery at wake and during sleep. */
async function summary(g: Garmin, date: string): Promise<Data> {
  const u = await g.get(`/usersummary-service/usersummary/daily?calendarDate=${date}`);
  const out: Data = {};
  const set = (k: string, v: number | undefined) => { if (v !== undefined) out[k] = v; };
  set("sedentary_min", mins(u?.sedentarySeconds));
  set("active_min", num(u?.activeSeconds) === undefined && num(u?.highlyActiveSeconds) === undefined ? undefined : mins((u.activeSeconds ?? 0) + (u.highlyActiveSeconds ?? 0)));
  set("body_battery_at_wake", num(u?.bodyBatteryAtWakeTime));
  set("body_battery_during_sleep", num(u?.bodyBatteryDuringSleep));
  return out;
}

/** A day's intraday detail: heart rate every 2 minutes, overnight hrv every 5, body battery's turning points. */
async function intraday(g: Garmin, date: string): Promise<db.Series> {
  const [hr, hrv, bb] = await Promise.all([
    g.get(`/wellness-service/wellness/dailyHeartRate?date=${date}`),
    g.get(`/hrv-service/hrv/${date}`),
    g.get(`/wellness-service/wellness/bodyBattery/reports/daily?startDate=${date}&endDate=${date}`),
  ]);
  const series: db.Series = {};
  const fromGmt = (start: unknown) => (typeof start === "string" ? Date.parse(`${start.slice(0, 19)}Z`) : NaN);
  const hrStart = fromGmt(hr?.startTimestampGMT);
  const hrPoints = (hr?.heartRateValues ?? []).filter((p: unknown[]) => num(p?.[0]) !== undefined && num(p?.[1]) !== undefined)
    .map((p: number[]) => [Math.round((p[0] - hrStart) / 60_000), p[1]] as [number, number]);
  if (hrPoints.length && Number.isFinite(hrStart)) series["heart rate"] = { unit: "bpm", points: hrPoints };
  const hrvPoints = (hrv?.hrvReadings ?? []).filter((r: any) => num(r?.hrvValue) !== undefined && typeof r?.readingTimeLocal === "string")
    .map((r: any) => [localMinute(date, r.readingTimeLocal), r.hrvValue] as [number, number]);
  if (hrvPoints.length) series["overnight hrv"] = { unit: "ms", points: hrvPoints };
  const report = Array.isArray(bb) ? bb.find((x: any) => x?.date === date) : null;
  const bbStart = fromGmt(report?.startTimestampGMT);
  const bbPoints = (report?.bodyBatteryValuesArray ?? []).filter((p: unknown[]) => num(p?.[0]) !== undefined && num(p?.[1]) !== undefined)
    .map((p: number[]) => [Math.round((p[0] - bbStart) / 60_000), p[1]] as [number, number]);
  if (bbPoints.length && Number.isFinite(bbStart)) series["body battery"] = { points: bbPoints };
  return series;
}

/** Writes days into the health tab: each checked against the tab's fields first, so the cron obeys the same schema as the api. */
async function store(database: D1Database, tab: Tab, days: Map<string, Data>): Promise<Map<string, number>> {
  const rows: Data[] = [];
  for (const data of days.values()) {
    const known = Object.fromEntries(Object.entries(data).filter(([k]) => tab.fields.some((f) => f.name === k)));
    const checked = checkRow(tab, known, { partial: false });
    if (typeof checked === "string") { console.log(`garmin ${data.date}: ${checked}`); continue; }
    rows.push(checked.set);
  }
  return rows.length ? db.mergeBy(database, TAB, "date", rows, BY) : new Map();
}

export type SyncReport = { calls: number; recent: number; backfilled: number; backfill: string; detailed: number };

export async function sync(env: GarminEnv, now = Date.now()): Promise<SyncReport | null> {
  const tab = await db.tab(env.DB, TAB);
  if (!tab || !env.GARMIN_API_KEY) return null; // nothing to write into, or no key: the cron is a no-op
  const today = iso(now + DAY); // garmin's days are local; tomorrow in utc covers every timezone, and a future day is just empty
  const recentStart = addDays(today, -3);
  const window = iso(now - INTRADAY_DAYS * DAY);
  const checkRecent = Math.floor(now / 3_600_000) % RECENT_EVERY === 0;
  let state = (await db.getMeta(env.DB, "garmin_backfill")) ?? `before ${recentStart} empty 0`;
  const owed = await db.missingSeries(env.DB, TAB, "date", "0000-00-00", 40);
  if (!checkRecent && state.startsWith("before done") && !owed.length) return null; // nothing owed this hour: no calls at all

  const g = await Garmin.connect(env);
  const report: SyncReport = { calls: 0, recent: 0, backfilled: 0, backfill: "", detailed: 0 };
  const writes: D1PreparedStatement[] = [];
  const detail = async (id: number, date: string) => { // 4 calls inside garmin's intraday window, 1 outside it
    const [extra, series] = await Promise.all([summary(g, date), date >= window ? intraday(g, date) : Promise.resolve({})]);
    if (Object.keys(extra).length) writes.push(db.mergeInto(env.DB, id, extra, BY));
    writes.push(db.putSeries(env.DB, id, series));
  };
  const cost = (date: string) => (date >= window ? 4 : 1);
  const done = new Set<string>();

  // 1. the recent days: numbers for the last few, detail for the two newest
  if (checkRecent) {
    const recent = await daily(g, recentStart, today);
    const latest = [...recent.keys()].sort().at(-1);
    if (latest) { // fitness age moves slowly and has no range call: read it for the newest day only
      const age = round((await g.get(`/fitnessage-service/fitnessage/v2/${latest}`))?.fitnessAge);
      if (age !== undefined) recent.get(latest)!.fitness_age = age;
    }
    const ids = await store(env.DB, tab, recent);
    report.recent = ids.size;
    for (const date of [...ids.keys()].sort().slice(-2)) { await detail(ids.get(date)!, date); done.add(date); }
  }

  // 2. one month of history, walking back from the oldest day stored
  const [, before, , emptyRuns] = state.split(" ");
  if (before !== "done" && g.calls + 5 <= BUDGET) {
    const end = addDays(before, -1), start = addDays(end, -(CHUNK - 1));
    const days = await daily(g, start, end);
    report.backfilled = (await store(env.DB, tab, days)).size;
    const empty = days.size ? 0 : Number(emptyRuns) + 1;
    state = empty >= 3 ? "before done empty 3" : `before ${start} empty ${empty}`; // three empty months in a row: the watch's history is in
    writes.push(db.setMeta(env.DB, "garmin_backfill", state));
  }
  report.backfill = state;

  // 3. each owed day's own detail, newest first, while the budget lasts
  for (const { id, date } of owed) {
    if (done.has(date)) continue;
    if (g.calls + cost(date) > BUDGET) break;
    await detail(id, date);
    report.detailed++;
  }
  if (writes.length) await env.DB.batch(writes);
  report.calls = g.calls;
  console.log(`garmin sync ${JSON.stringify(report)}`);
  return report;
}
