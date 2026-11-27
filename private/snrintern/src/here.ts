// Your today: the date where you are, not in utc. Every "today", "yesterday", "2 days ago", window and live label counts from it.
// In california utc is already tomorrow from 4pm, so counting days in utc called last night's session "2 days ago".
// Where you are comes from the newest training row: the watch writes every activity's start with its offset
// (2026-11-25T18:30-08:00), so the offset follows you when you travel. With no timed row yet, utc.
import { TRAINING } from "./activities.ts";

const OFFSET = /([+-])(\d{2}):(\d{2})$/;

/** Minutes east of utc where you last trained (-480 in california in winter), or 0. */
export async function offsetHere(database: D1Database): Promise<number> {
  // newest by the instant, not the text: sqlite's julianday reads the offset, so 00:30-12:00 sorts after 07:00-08:00 the same date
  const r = await database.prepare("SELECT json_extract(data, '$.at') AS at FROM rows WHERE tab = ? AND json_extract(data, '$.at') LIKE '%T%' ORDER BY julianday(json_extract(data, '$.at')) DESC LIMIT 1")
    .bind(TRAINING).first<{ at: string }>();
  const m = r && OFFSET.exec(r.at);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** Today's date where you are, as the utc midnight of that date (the form every day count here uses). */
export function dayAt(offset: number, now = Date.now()): number {
  const local = new Date(now + offset * 60_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

export const todayHere = async (database: D1Database) => dayAt(await offsetHere(database));
