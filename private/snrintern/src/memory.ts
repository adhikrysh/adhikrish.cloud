// A coach's memory is its rows in the notes tab: it adds, edits and removes them like any rows. The one rule senior intern
// enforces is size: a coach's notes together stay under CAP words, so its memory stays worth reading every conversation even if
// the agent never tidies up. A write that would pass the cap is refused with what to do; every read and write of notes says how
// full each coach is, so the agent can tidy before it hits the wall. No AI here: what to keep is the agent's judgement.
import * as db from "./db.ts";
import type { Tab } from "./schema.ts";

export const NOTES = "notes";
export const CAP = 1000; // words per coach

const words = (s: unknown) => String(s ?? "").split(/\s+/).filter(Boolean).length;

/** Words each coach's notes use now, or as they would after `change` (a new row, or row `id` with its new values). */
export async function usage(database: D1Database, tab: Tab, change?: { id?: number; coach: string; note: string }): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  for (const r of await db.list(database, tab)) {
    if (change?.id !== undefined && r.id === change.id) continue;
    used.set(String(r.coach), (used.get(String(r.coach)) ?? 0) + words(r.note));
  }
  if (change) used.set(change.coach, (used.get(change.coach) ?? 0) + words(change.note));
  return used;
}

export const report = (used: Map<string, number>) => Object.fromEntries([...used].map(([coach, n]) => [coach, { used: n, cap: CAP }]));

/** The refusal when a write would pass the cap, or null. */
export function overCap(used: Map<string, number>, coach: string): string | null {
  const n = used.get(coach) ?? 0;
  return n > CAP ? `memory full: ${coach}'s notes would be ${n} of ${CAP} words. edit or remove notes that no longer matter, then retry` : null;
}
