# health: garmin into senior intern

how does a day on the watch end up as a line on `seniorintern.adhikrish.cloud/health`, and how does that page decide what to say about it?

**the short answer.** the watch uploads to garmin through the phone. every hour a cron trigger wakes the senior intern worker, which asks garmin's official personal api for the days it doesn't have yet and writes one row per day (the day's numbers) plus that day's streams (heart rate every 2 minutes, overnight hrv, body battery) into d1. nothing runs on the thinkpad. `GET /api/health/_views` judges each metric's newest day by fixed rules, garmin's own verdict first, for the agent; the page shows only the days, each as a few words.

## the objects

- **the personal api.** garmin's official api for one person's own data (`personal.connectapi.garmin.com`). you make a **key** in garmin connect web (settings > personal api key), valid for up to a year. the key buys a **bearer token** that lasts 24 hours; there are no refresh tokens, a new token is one call. the key lives in 1password (`Personal` > `garmin personal api key`) and on the worker as the secret `GARMIN_API_KEY`.
- **a health row.** one row per local calendar day in the `health` tab: about 55 numbers and words (resting hr, hrv, sleep and its stages, steps, body battery, garmin's own verdicts as words...). the tab's definition is data in d1 like every tab; its copy in git is `private/snrintern/test/fixtures/tabs.json`.
- **a series.** a day's streams, in their own table (`series`, one row per health row), as `[minute from local midnight, value]` pairs. kept out of `rows` so lists and views never parse them; only that day's page and the full metric pages read them.
- **meta.** `garmin_backfill` says how far back the days have reached; `garmin_activities` how far the activities have (see [`training.md`](training.md)).
- **the cron trigger.** cloudflare calls the worker's `scheduled` handler at minute 17 of every hour (`private/snrintern/cloudflare.config.ts`). code: [`src/garmin.ts`](../private/snrintern/src/garmin.ts).

## one hour, traced

```text
:17 cron fires, scheduled(time)
  └─► sync (src/garmin.ts)
        ├─► no health tab or no key? stop: nothing to do
        ├─► an hour that isn't every 3rd, history all in, nothing owed? stop: no calls
        ├─► POST key → 24h token                                  1 call
        ├─► every 3rd hour: the last few days
        │     5 range calls (daily summaries, sleep, hrv,         5
        │     vo2max, weight), fitness age for the newest day     1
        │     and the two newest days' detail                     8
        │     the 20 newest activities (training.md)          1 + 1 each new
        ├─► history not all in: the 30 days before the oldest     5
        │   row (sleep refuses longer ranges); three empty
        │   months in a row means the watch's history is in
        ├─► activities not all in: the next page of them      1 + 1 each new
        └─► owed detail, newest first, while the budget lasts:
              inside garmin's ~4 month window: heart rate,
              hrv readings, body battery, the day summary          4 a day
              older: the day summary only                         1 a day
        stops spending at 48 calls (the free plan allows 50)
  writes merge into each day's row (json_patch), series upsert
```

a recent day keeps changing (the phone syncs whenever it syncs), so recent days are fetched again every third hour; an older day is final. steady state is about 16 calls every third hour, about 130 a day. the weight range call's weigh-ins go to the body tab, not health. a full backfill of years of daily numbers takes a few days of hourly runs.

## the verdicts

the agent reads them at `GET /api/health/_views`; they're off the page (`page: false`), which lists only the days. one line per metric, defined by the tab's `metrics` views ([`src/views.ts`](../private/snrintern/src/views.ts), contract in [`API.md`](../private/snrintern/API.md)):

```text
{ "field": "sleep_score", "value": 53, "shown": "53",
  "verdict": "poor", "tone": "bad", "when": "today" }
```

**how a day is judged, closest to the source of truth first.** each metric uses the first rule it has:

| rule | metric | what it says | source |
|---|---|---|---|
| garmin's word | sleep score | garmin's label for the night: excellent (green), good, fair, poor (red) | the sleep score's own qualifier |
| garmin's word | hrv | garmin's status: balanced, unbalanced, low or poor (the last three red) | garmin's hrv status |
| garmin's bands | body battery at wake | 76 to 100 high (green), 51 to 75 medium, 26 to 50 low and 5 to 25 very low (red) | forerunner 955 owner's manual |
| garmin's bands | stress | 0 to 25 rest (green), 26 to 50 low, 51 to 75 medium and 76 to 100 high (red) | garmin's stress scale |
| garmin's goal | steps | goal met (green), or how far short | garmin's daily step goal, stored on the row |
| garmin's goal | intensity | the week's minutes against garmin's weekly goal | garmin's weekly goal, stored on the row |
| your history | resting hr | higher or lower than 80% of your previous 28 days (red / green), and red above 100 bpm | garmin gives no verdict; 100 is the clinical upper bound (american heart association) |

garmin's labels are taken as garmin returns them for each day, never re-derived from numbers we believe garmin uses.

- **steps and intensity** judge yesterday: today isn't finished, so it's shown as "so far" and never judged.
- **"today" means today where you are** (garmin's dates are local, so today or yesterday in utc). if the newest synced day is older than that, nothing reads as today, yesterday or "so far": days show their dates, so stale data can't pass for current.
- **the log** reads each day as its big picture: every metric judged good or bad that day gives its words ("poor sleep", "well recovered"), at most two, bad first, else "an ordinary day".
- **each metric still has its page by url** (`/health/metrics/<field>`, nothing links to it now): the value and its verdict, then a zoomable chart (lightweight-charts, served by the worker at `/_charts-<version>.js`). metrics with a stream open on `1d` / `3d` of it; `10d` to `all` show one dot per day; your usual shows as dashed lines only where the verdict is your own history. a click on a dot opens that day.

all of this is arithmetic in the worker at render time: no model, so no cost, and the same numbers always read the same.

## misconceptions we hit

**wrong:** you need the unofficial `garminconnect` python library and a home ip (the thinkpad) to get garmin data. **why it fails:** that library exists because garmin had no personal api; it logs in like the phone app and fights garmin's bot protection. garmin now has an official one for exactly this. **instead:** a key you make yourself, a 24 hour token, plain https from the worker. no login, no python, no thinkpad.

**wrong:** the worker checks garmin when you open the page. **why it fails:** the worker only answers requests; nothing ties a page view to garmin. **instead:** the cron pushes data into d1 on its own schedule; pages only read d1.

**wrong:** the daily numbers are averages we computed from the streams, so the streams make them redundant (or the other way round). **why it fails:** the daily numbers are garmin's own daily metrics (resting hr is the lowest stretch of the day, steps a total), and for stress, steps and sleep there is no finer data at all from this api. **instead:** daily numbers answer "how am I trending", streams answer "what happened that day". both are kept.

**wrong:** garmin keeps the raw data, so it can always be fetched again. **why it fails:** the personal api returns intraday data for only about the last 4 months. **instead:** the `series` table is the only long-term copy. never delete it; at about 4 MB a year it never needs to be.

**wrong:** the page should judge every number against your own history. **why it fails:** your history can be a bad baseline (six hours of sleep every night reads "usual"), and a middle-half band flags half of all days by construction. garmin already scores most of these days with its own models. **instead:** garmin's own label, bands or goal wherever garmin has one; your history only where it doesn't (resting hr), and then only the outer 20%.

**wrong:** a tab can be called anything. **why it fails:** the worker's readiness check lived at `/health`, so a `health` tab could never show its page. **instead:** system paths are underscored (`/_health`, `/api/_tabs`), and tab slugs must start with a letter, so they can't collide.

## predict what happens

1. **a normal hour.** recent days refresh every third hour; other hours fill owed detail, then make no calls once nothing is owed.
2. **the key expires** (garmin emails a week before). the token call fails, the worker logs `garmin token: <status>`, no rows change, the pages keep showing what's stored. fix: make a new key, update 1password, `cf workers secrets update GARMIN_API_KEY --worker snrintern`.
3. **garmin is down or one endpoint fails.** a failed call reads as nothing; that field is just missing for that day and the next run fills it. one broken endpoint (vo2max failing every time in the test) never stops the rest.
4. **you don't wear the watch for a week.** those days have no row. the box's line breaks over gaps longer than 2 days; the band uses the days that exist.
5. **the worker is deployed with a new field in the definition.** existing rows lack it until the next fetch of that day merges it in; for old days that means never, unless the backfill state is reset.

## invariants

- the cron never spends more than 48 outside requests in one run.
- writes merge: a field once fetched is never wiped by a later call that doesn't carry it.
- one row per date: the sync looks rows up by `date` before inserting.
- only the sync writes the health tab; agents read it.
- pages never call garmin.

## changing it safely

- **a new metric:** add it to the `metrics` view in the definition (`PUT /api/_tabs/health`), keep `test/fixtures/tabs.json` in step, run `bun test`.
- **a new garmin field:** map it in `daily()` or `summary()` in `src/garmin.ts`, add the field to the definition, and extend the fake in `test/fake-garmin.ts` (real response shapes, made-up numbers).
- **refetching history** (after adding a field): delete the `garmin_backfill` key from `meta`; the next runs walk back again and merge the new field in.

## open questions

- garmin's rate limits for the personal api aren't published. about 120 calls a day in steady state has been fine so far.
- the personal api lacks training readiness, training status, endurance score and race predictions. if garmin adds them, they're one mapping each.
