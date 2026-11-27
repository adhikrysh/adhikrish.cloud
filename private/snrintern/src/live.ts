// Live labels: a tab whose name is a number about your life, worked out from your birthday on every request.
// The birthday is the worker secret BIRTHDAY (yyyy-mm-dd), never in git or d1: it never changes, and the repo is public.
// A tab opts in with `"live": "<kind>"` in its definition; without the secret it keeps its plain label.
//   weeks_left       4,000 weeks (28,000 days) minus the weeks you've lived: "2780.29 weeks"
//   felt_time_left   how much of your life is left as it feels. by the proportional theory of felt time, a year at age t feels
//                    like 1/t of one, so felt time from age a to b is ln(b/a). counting from age 7 (before it, childhood amnesia
//                    keeps almost nothing), the share left is 1 - ln(age/7) / ln(end/7), with end = 28,000 days: "49.62% of
//                    perceptive time". its felt midpoint is about age 23.
import type { Tab } from "./schema.ts";

export const LIVE = ["weeks_left", "felt_time_left"] as const;
export type Live = (typeof LIVE)[number];

const DAY = 86_400_000, LIFE = 28_000, YEAR = 365.25, FROM = 7;

/** Whole days from the birthday to today (both as utc dates). */
const daysLived = (birthday: string, now: number) => Math.floor((Math.floor(now / DAY) * DAY - Date.parse(`${birthday}T00:00:00Z`)) / DAY);

export function liveLabel(live: Live, birthday: string, now = Date.now()): string {
  const days = daysLived(birthday, now);
  if (live === "weeks_left") return `${(Math.max(0, LIFE - days) / 7).toFixed(2)} weeks`;
  const age = days / YEAR, end = LIFE / YEAR;
  const left = age <= FROM ? 1 : Math.max(0, 1 - Math.log(age / FROM) / Math.log(end / FROM));
  return `${(left * 100).toFixed(2)}% of perceptive time`;
}

/** The tab as people and agents see it: its live label in place of its plain one, when it has one and the birthday is set. */
export const named = (tab: Tab, birthday: string | undefined): Tab =>
  tab.live && birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? { ...tab, label: liveLabel(tab.live, birthday) } : tab;
