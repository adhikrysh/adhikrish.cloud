# training: garmin activities and the agent's sessions as one log

how do a run the watch recorded and a gym session you told the agent about end up as rows in `seniorintern.adhikrish.cloud/training`, and how does a session both of them know about become one row instead of two?

**the short answer.** the hourly garmin sync (the same cron as health, [`health.md`](health.md)) lists garmin's activities and writes each into the training tab. the agent writes sessions through the api as before. both sides look for the other's row before writing: same local day, starts within 2 hours. if they find it, they merge into it. garmin's fields come from the watch, the agent's from you, and neither side overwrites the other. code: [`src/activities.ts`](../private/snrintern/src/activities.ts).

## the objects

- **an activity.** one recording on the watch (a run, a strength session, a hike, a swim). garmin's list call gives most of its numbers; a detail call per activity adds what you entered on the watch afterwards (perceived effort and feel) and stamina. the raw recording (a FIT file, ~700 KB) is never fetched: every number worth keeping is already in the summaries.
- **a training row.** one session. the agent's fields: `focus`, `lifts`, `rpe`, `notes`. garmin's fields: `at` (the start), `duration_min`, `distance_km`, heart rate, load, training effect, hr zones, splits, `watch_rpe`, `watch_feel`, `garmin_type` and `garmin_id`. `type` and `title` are the agent's, but garmin fills them on a row that has none, so a run you never mentioned still reads "run".
- **the link.** `garmin_id` on a row says which activity it is. a row without one is the agent's alone.
- **a weigh-in.** the weight range call (already part of the daily sync) carries garmin's weigh-ins; each day's latest becomes a body row, linked the same way.
- **meta.** `garmin_activities` holds how far the backfill has listed (`offset 120`), then `done`.

## one session, traced both ways

```text
agent first: you tell the agent "chest day, 18:00"
  POST /api/training { at 18:00, lifts... }
    └─► no garmin row near 18:00 that day: a new row (201)
:17 the cron lists activities: strength 18:20 that day
    └─► an unlinked row that day, 20 min away: merge into it
          garmin's at, duration, hr...; your lifts stay

garmin first: the watch syncs a run before you mention it
:17 the cron: no row near it, a new row
      type "run", title "menlo park running" (garmin's)
  later: POST /api/training { at 07:05, title "easy run" }
    └─► a garmin row 5 min away, nothing of yours on it yet:
          your fields land on it (200, "merged": "garmin");
          its distance and time stay the watch's
```

when several rows and activities could pair (two hikes in one morning, one logged), every pairing is ranked by how close the starts are, and the closest pair first. a row with only a date (written before times were required) pairs after any timed one. the type doesn't have to agree: you might call a hike a walk, and your word stays.

## the hour's budget

the activity steps share the sync's 48 calls (the free plan allows 50):

- **every third hour:** list the 20 newest activities (1 call, plus 1 detail per new one), then look for deletions in that span.
- **until the history is in:** one page of older activities per run, as many as the budget left allows (up to 100). a page shorter than asked means the first activity ever has been listed, and the backfill is `done`.

a backfill of 188 activities takes a handful of hourly runs; after that it costs 1 call every third hour.

## what the agent reads

training's views are numbers for the agent, not for the page: each has `page: false`, so the training page shows only the log, and `GET /api/training/_views` computes them from these rows whenever it's asked. one function returns both the numbers and the html, so a view switched back onto a page draws exactly what the agent reads ([`src/views.ts`](../private/snrintern/src/views.ts)). nothing is stored, so nothing goes stale when the backfill adds an old run, you delete an activity or the agent fixes a row. every window counts whole local days ending today where you are (the newest row's offset says where that is).

- **load.** the last 7 days of garmin's per-session training load, and the 4-week average a week. it says "higher" or "lower than usual" only against your own past weeks (10th and 90th percentile of up to a year), and never colours it.
- **run limit.** the longest run of the last 30 days, the next run's limit 10% past it, and any run in those 30 days that went more than 10% past the longest of the 30 days before it, in red.
- **weeks.** for each sport done in the last 4 weeks: this week's time and distance ("no time logged" when the sessions carry none, like a gym day the agent wrote without the watch), a box of 12 weeks, and time in each heart-rate zone over the last 28 days.
- **records.** fastest 1, 5 and 10 km, longest run, ride and swim, most climbing: the best of the last 90 days next to the best ever.

the agent reads `/_views` instead of redoing the sums: a few lines instead of hundreds of rows, and no arithmetic for a model to get wrong. deciding what to do with them (rest, easy run, push) is the agent's reasoning, never the worker's.

**why not the acute:chronic ratio.** dividing the 7-day load by the 28-day average, with 0.8 to 1.3 as a "sweet spot" and over 1.5 as a danger zone (gabbett, 2016), was popular and doesn't hold up: the 7 days sit inside the 28, so the two are coupled and part of the link to injury is arithmetic (lolli et al., 2019); a ratio hides how much work it describes and jumps when the base is small; and the curve came from modelling choices, not a validated test (impellizzeri et al., 2020). a 2025 study of about 5,200 garmin runners (frandsen, skejø, nielsen, bjsm) found weekly ratio spikes went with *fewer* injuries, while a single run more than 10% longer than the longest of the previous 30 days raised overuse injuries (64% at 10 to 30% longer, 52% at 30 to 100%, 128% past double). that study is observational and covers recreational runners and running distance only, so the limit applies to runs and nothing else.

## misconceptions we hit

**wrong:** garmin is the source of truth for training, so its rows should replace the agent's. **why it fails:** garmin knows the heart rate of a gym session but not one lift in it; the agent's log is the only record of what you lifted and how it felt. **instead:** each side owns what only it can know, and either alone is a real session.

**wrong:** a session is the same if the type matches. **why it fails:** the agent writes what you said ("a walk with friends"); garmin writes what you pressed on the watch ("hiking"). **instead:** match on time: same local day, starts within 2 hours, closest first.

**wrong:** we can write the agent's notes back to garmin. **why it fails:** the personal api only has GET endpoints. **instead:** the merge happens in senior intern; garmin stays the watch's record.

**wrong:** the agent can log just a date. **why it fails:** without a time, two sessions on one day can't be told apart, and a date-only row pairs with whichever activity happens to be that day. **instead:** training's `at` has `time: true`; the api refuses a date alone, and the agent asks you for the start when it doesn't know. old date-only rows still match on their date.

## predict what happens

1. **you lift at 18:00 and log it at 22:00 with `at` 21:45.** 3 h 45 min from the watch's start: two rows. the agent should log the start, not when it writes.
2. **you delete an accidental activity in garmin connect.** within three hours the recent check sees it gone: the row goes if only garmin wrote to it; if the agent wrote to it, it stays and loses its `garmin_id`.
3. **the detail call fails for a new activity.** the row lands without `watch_rpe`, `watch_feel` and stamina, and isn't retried; everything else is there.
4. **you delete an activity while the backfill is paging.** the offsets shift by one and one older activity may be skipped. the backfill only runs once, so this is unlikely; deleting the `garmin_activities` key from `meta` lists everything again, and nothing duplicates.

## invariants

- one row per garmin activity: a listed activity merges into the row linked to it before anything else.
- garmin never overwrites `focus`, `lifts`, `rpe` or `notes`, and never overwrites a `type` or `title` that is already set.
- the only delete: a row only garmin wrote to, whose activity is gone from garmin's recent list.
- the activity steps stay inside the sync's 48-call budget.

## changing it safely

- **a new garmin number:** map it in `fromList` or `fromDetail` in `src/activities.ts`, add the field to the training definition (`PUT /api/_tabs/training`, and `test/fixtures/tabs.json`), extend `test/fake-garmin.ts`, run `bun test`. old rows get it after a refetch: delete `garmin_activities` from `meta`.
- **a new sport:** `sport()` maps garmin's type keys to the tab's types; anything unknown is `other`, with garmin's own word in `garmin_type`.

## open questions

- the weigh-in shape (`samplePk`, `date`, `timestampGMT`) follows garmin's api as documented elsewhere; this account has no weigh-ins yet, so it's untested against a real one.
- garmin's strength sessions carry no sets from this watch (one "unknown" set), so lifts stay the agent's alone.
