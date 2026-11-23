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

export function startFakeGarmin() {
  const calls: string[] = [];
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
        const d = iso(today() - 20 * DAY);
        return json({ dailyWeightSummaries: range(seg[4], seg[5]).includes(d) ? [{ summaryDate: d, latestWeight: { weight: 70_100 } }] : [] });
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
  return { server, calls, url: `http://127.0.0.1:${server.port}` };
}
