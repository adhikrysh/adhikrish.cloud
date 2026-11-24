// A fake of garmin's Personal API for the e2e test: the same paths, auth and response shapes as the real one (taken from real
// responses), with made-up numbers. History starts HISTORY days ago; one day was never worn; intraday detail only exists for
// the last 120 days, like garmin; vo2max always fails, to prove one broken endpoint doesn't sink a run; sleep refuses ranges
// over 30 days, like garmin. Every request is counted, so the test can check each run stays under the free plan's limit.
const DAY = 86_400_000;
export const HISTORY = 150; // past garmin's 120-day intraday window, so the oldest days get numbers but no detail
export const NOT_WORN = 10; // days ago
const KEY = "test-garmin-key", TOKEN = "fake-bearer-token";

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const today = () => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };
const ago = (date: string) => Math.round((today() - Date.parse(`${date}T00:00:00Z`)) / DAY);
const worn = (date: string) => { const a = ago(date); return a >= 0 && a <= HISTORY && a !== NOT_WORN; };
const range = (a: string, b: string) => { const out: string[] = []; for (let t = Date.parse(`${a}T00:00:00Z`); t <= Date.parse(`${b}T00:00:00Z`); t += DAY) out.push(iso(t)); return out; };
const gmt = (ms: number) => new Date(ms).toISOString().slice(0, 21).replace("Z", "");
// pacific: local midnight is 08:00 utc
const midnightGmt = (date: string) => Date.parse(`${date}T08:00:00Z`);

/** The made-up numbers: this week is unusual on purpose (hrv up, resting hr down, stress up) so the metrics view must colour it. */
export function numbers(date: string) {
  const a = ago(date), wobble = (a * 7) % 5, thisWeek = a < 7;
  return {
    hrv: thisWeek ? 72 + (a % 2) : 50 + wobble, rhr: thisWeek ? 46 : 52 + (a % 3), stress: thisWeek ? 45 + (a % 2) : 26 + (a % 4),
    steps: 8000 + ((a * 1373) % 6000), sleepSeconds: 7 * 3600 + ((a * 911) % 3600),
  };
}

function summary(date: string) {
  const n = numbers(date);
  return {
    calendarDate: date, includesWellnessData: true, source: "WELLNESS",
    movement: { steps: { value: n.steps, distanceInMeters: n.steps * 0.78, goal: 10000 }, floorsAscended: { value: 7.6, goal: 10 } },
    calories: { burnedTotal: 2400.4, burnedActive: 520.7, burnedResting: 1879.7 },
    heartRate: { restingValue: n.rhr, minValue: n.rhr - 4, maxValue: 151 },
    intensityMinutes: { moderate: 20, vigorous: 10, goal: 150 },
    stress: { avgLevel: n.stress, maxLevel: 96, qualifier: "balanced", restDurationInMillis: 25_200_000, lowStressDurationInMillis: 18_000_000,
      mediumStressDurationInMillis: 7_200_000, highStressDurationInMillis: 1_800_000 },
    bodyBattery: { maxValue: 96, minValue: 16, chargedValue: 80, drainedValue: 70,
      endOfDayDynamicFeedbackEvent: { feedbackLongType: "SLEEP_TIME_PASSED_BALANCED_AND_INACTIVE" } },
    respiration: { avgValue: 14.24, minValue: 9.0, maxValue: 21.5 },
  };
}

function sleep(date: string) {
  const n = numbers(date), bed = midnightGmt(date) - 8 * 3600_000 - 20 * 60_000; // 11:40pm local the night before, as a "local" epoch
  return {
    calendarDate: date, sleepTimeSeconds: n.sleepSeconds, deepSleepSeconds: 5400, lightSleepSeconds: n.sleepSeconds - 5400 - 6000,
    remSleepSeconds: 6000, awakeSleepSeconds: 900, napTimeSeconds: 0, avgHeartRate: 49.6, avgSleepStress: 14.2,
    sleepStartTimestampLocal: bed, sleepEndTimestampLocal: bed + n.sleepSeconds * 1000 + 900_000,
    sleepScores: { overall: { value: 84, qualifierKey: "GOOD" } }, sleepNeed: { actual: 540, baseline: 480, feedback: "HIGHLY_INCREASED" },
    sleepScoreFeedback: "POSITIVE_OPTIMAL_STRUCTURE", sleepScoreInsight: "NONE", sleepScorePersonalizedInsight: "STRESS_POS_EXCELLENT_OR_GOOD_SLEEP_RESTFUL_DAY",
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** A day `n` days ago as yyyy-mm-dd, and garmin's local and gmt wall times for a local time on it (pacific, utc-8). */
const daysAgo = (n: number) => iso(today() - n * DAY);
const wallTimes = (n: number, time: string) => {
  const local = Date.parse(`${daysAgo(n)}T${time}:00Z`), text = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
  return { startTimeLocal: text(local), startTimeGMT: text(local + 8 * 3_600_000) };
};

/** One listed activity, in the list call's shape (taken from a real one), and its detail's extras. */
function activity(id: number, ago: number, time: string, typeKey: string, name: string,
  o: { min: number; km?: number; hr?: number; elev?: number; load?: number; rpe?: number; feel?: number }) {
  const km = o.km ?? 0, hr = o.hr ?? 130, s = o.min * 60;
  return {
    list: {
      activityId: id, activityName: name, ...wallTimes(ago, time), activityType: { typeId: 1, typeKey, parentTypeId: 17 },
      distance: km * 1000, duration: s + 0.49, movingDuration: s - 120, elevationGain: o.elev ?? 0, averageHR: hr, maxHR: hr + 25,
      calories: Math.round(o.min * 9.6), activityTrainingLoad: o.load ?? o.min * 1.3 + 0.4, aerobicTrainingEffect: 2.6, anaerobicTrainingEffect: 0.4,
      trainingEffectLabel: "AEROBIC_BASE", aerobicTrainingEffectMessage: "IMPROVING_AEROBIC_BASE_8", differenceBodyBattery: -9,
      moderateIntensityMinutes: Math.round(o.min / 2), vigorousIntensityMinutes: 5,
      hrTimeInZone_1: 300, hrTimeInZone_2: s - 900, hrTimeInZone_3: 600, hrTimeInZone_4: 0, hrTimeInZone_5: 0,
      ...(km ? { averageRunningCadenceInStepsPerMinute: 162.4, avgPower: 263, fastestSplit_1000: 331.6 } : {}),
      ...(km >= 5 ? { fastestSplit_5000: 1702.2 } : {}),
      summarizedExerciseSets: typeKey === "strength_training" ? [{ category: "UNKNOWN", reps: 0, volume: 0, sets: 1, maxWeight: 0 }] : undefined,
    },
    detail: { activityId: id, summaryDTO: { directWorkoutRpe: o.rpe, directWorkoutFeel: o.feel, ...(km ? { beginPotentialStamina: 97, endPotentialStamina: 61 } : {}) } },
  };
}

/** The watch's activities, newest first. The test leans on each one: see e2e.test.ts. Old runs every 5 days fill the history,
 * so the backfill has to page. */
export function activities() {
  const named = [
    activity(9001, 5, "18:00", "strength_training", "Strength", { min: 65, hr: 108, rpe: 70, feel: 75 }), // the agent logs it after
    activity(9002, 2, "07:10", "running", "Menlo Park Running", { min: 31, km: 5.04, hr: 148, rpe: 50, feel: 50 }), // agent logged 07:00
    activity(9003, 3, "18:00", "running", "Menlo Park Running", { min: 42, km: 7.5, hr: 151 }), // agent logged the date only
    activity(9004, 4, "07:00", "running", "Menlo Park Running", { min: 25, km: 4.1, hr: 139 }), // garmin only
    activity(9006, 8, "09:53", "hiking", "Mariposa County Hiking", { min: 201, km: 7.34, hr: 137, elev: 963 }), // the agent's "walk" at 09:30
    activity(9005, 8, "08:00", "hiking", "Mariposa County Hiking", { min: 112, km: 4.32, hr: 125, elev: 330 }), // same morning, its own row
    activity(9007, 13, "21:30", "strength_training", "Strength", { min: 45, hr: 104 }), // 3.5 hours after the agent's 18:00: not that one
    activity(9008, 20, "18:20", "strength_training", "Strength", { min: 58, hr: 110 }), // the agent's 18:00 chest day
    activity(9009, 30, "06:30", "lap_swimming", "Pool Swim", { min: 40, km: 1.5, hr: 128 }),
    activity(9010, 40, "17:00", "soccer", "Soccer", { min: 90, km: 8.2, hr: 155 }),
  ];
  const old = Array.from({ length: 60 }, (_, i) => activity(8000 + i, 45 + i * 5, "07:00", "running", "Menlo Park Running", { min: 30, km: 5.2, hr: 145 }));
  return [...named, ...old];
}

export function startFakeGarmin() {
  const calls: string[] = [];
  const acts = activities(); // the test deletes from this, the way you would delete one in garmin connect
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url), p = url.pathname, q = (k: string) => url.searchParams.get(k) ?? "";
      calls.push(`${request.method} ${p}`);
      if (p === "/personalapitoken-service/personal-api/personal-api-key/token") {
        return request.headers.get("authorization") === `ApiKey ${KEY}` ? new Response(TOKEN) : new Response("bad key", { status: 401 });
      }
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return json({ message: "unauthorized" }, 401);
      const seg = p.split("/");
      if (p === "/usersummary-service/v2/dailysummaries") return json({ data: range(q("startDate"), q("endDate")).filter(worn).map(summary) });
      if (p === "/sleep-service/sleep/dailySleepSummariesByDate") {
        const days = range(q("startDate"), q("endDate"));
        return json(days.length > 30 ? {} : days.filter(worn).map(sleep));
      }
      if (p.startsWith("/hrv-service/hrv/daily/")) {
        return json({ hrvSummaries: range(seg[4], seg[5]).filter(worn).map((d) => ({ calendarDate: d, lastNightAvg: numbers(d).hrv, weeklyAvg: 55,
          status: "BALANCED", feedbackPhrase: "HRV_BALANCED_4", baseline: { balancedLow: 48, balancedUpper: 62 } })) });
      }
      if (p.startsWith("/metrics-service/metrics/maxmet/daily/")) return json({ error: "boom" }, 500);
      if (p.startsWith("/weight-service/weight/range/")) {
        // weigh-ins 20 days ago (a day the agent logged nothing) and yesterday (the agent logged 69.4 by hand, with no time)
        const ins = [[20, 70_100, 15.2, 501], [1, 69_800, undefined, 502]] as const;
        return json({ dailyWeightSummaries: ins.filter(([n]) => range(seg[4], seg[5]).includes(daysAgo(n))).map(([n, g, fat, pk]) => {
          const local = Date.parse(`${daysAgo(n)}T07:30:00Z`);
          return { summaryDate: daysAgo(n), numOfWeightEntries: 1, latestWeight: { samplePk: pk, date: local, calendarDate: daysAgo(n), weight: g, bodyFat: fat ?? null, timestampGMT: local + 8 * 3_600_000, sourceType: "MANUAL" } };
        }) });
      }
      if (p === "/activitylist-service/activities/search/activities") {
        const start = Number(q("start")), limit = Number(q("limit"));
        return json(acts.slice(start, start + limit).map((a) => a.list));
      }
      if (seg[1] === "activity-service" && seg[2] === "activity") {
        const a = acts.find((x) => String(x.list.activityId) === seg[3]);
        return a ? json(a.detail) : json({ message: "not found" }, 404);
      }
      if (p.startsWith("/fitnessage-service/fitnessage/v2/")) return json({ fitnessAge: 24.63, chronologicalAge: 25 });
      if (p === "/usersummary-service/usersummary/daily") {
        const d = q("calendarDate");
        return json(worn(d) ? { calendarDate: d, sedentarySeconds: 41_400, activeSeconds: 3_000, highlyActiveSeconds: 600, bodyBatteryAtWakeTime: 91, bodyBatteryDuringSleep: 77 } : {});
      }
      const intradayDay = (d: string) => worn(d) && ago(d) <= 119;
      if (p === "/wellness-service/wellness/dailyHeartRate") {
        const d = q("date");
        if (!intradayDay(d)) return json({ calendarDate: d, heartRateValues: null });
        const start = midnightGmt(d);
        // every 2 minutes, except the watch was off from 13:00 to 13:40, and one reading is null
        const values = Array.from({ length: 720 }, (_, i) => [start + i * 120_000, i === 100 ? null : 55 + Math.round(20 * Math.sin(i / 60))])
          .filter(([t]) => { const m = ((t as number) - start) / 60_000; return m < 780 || m >= 820; });
        return json({ calendarDate: d, startTimestampGMT: gmt(start), startTimestampLocal: `${d}T00:00:00.0`, heartRateValues: values });
      }
      if (seg[1] === "hrv-service" && seg[2] === "hrv" && seg.length === 4) {
        const d = seg[3];
        if (!intradayDay(d)) return json({ hrvReadings: [] });
        const prev = iso(Date.parse(`${d}T00:00:00Z`) - DAY);
        // overnight: 23:40 the night before to 02:55, every 5 minutes (local wall time strings, like garmin)
        const readings = Array.from({ length: 40 }, (_, i) => {
          const m = -20 + i * 5, day = m < 0 ? prev : d, mm = ((m % 1440) + 1440) % 1440;
          return { hrvValue: 60 + (i % 9), readingTimeLocal: `${day}T${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}:12.0` };
        });
        return json({ hrvSummary: { calendarDate: d }, hrvReadings: readings });
      }
      if (p === "/wellness-service/wellness/bodyBattery/reports/daily") {
        const d = q("startDate");
        if (!intradayDay(d)) return json([]);
        const s = midnightGmt(d);
        return json([{ date: d, startTimestampGMT: gmt(s), bodyBatteryValuesArray: [[s, 16], [s + 468 * 60_000, 96], [s + 573 * 60_000, 99], [s + 954 * 60_000, 57], [s + 1431 * 60_000, 26]] }]);
      }
      return json({ message: `no fake for ${p}` }, 404);
    },
  });
  return { server, calls, activities: acts, url: `http://127.0.0.1:${server.port}` };
}
