# senior intern api

base url: `https://seniorintern.adhikrish.cloud`. the agent writes through this api; the pages are read-only. everything a page shows comes from rows and tab definitions, so new tabs, columns, exercises and charts need no code change.

## auth

send both headers on every request. each agent has its own token, in 1password: `adhikrish.cloud-ci › snrintern dots token` for dots, `adhikrish.cloud-ci › snrintern instinct token` for instinct. rows record which one wrote them (`updated_by`).

```
CF-Access-Client-Id: <client-id>
CF-Access-Client-Secret: <client-secret>
```

cloudflare access checks them before the request reaches the worker. without them you get a 302 to a login page. a token that isn't on the agent list (`AGENT_CLIENT_IDS`) gets `403`.

## discover first

`GET /api` returns every tab with its definition and row count, plus the field types and view kinds. tabs change, so read it before writing and never hard-code the list. this document itself is `GET /api/_docs`, served by the same deploy as the code, so it always describes what is running.

## field types

| type | accepts | example |
|---|---|---|
| `text` | any string | `"met at the demo night"` |
| `int` | a whole number; optional `min`, `max`, `unit` | `62` |
| `number` | a decimal; optional `min`, `max`, `unit` | `68.4` |
| `date` | `yyyy-mm-dd` | `"2026-11-18"` |
| `datetime` | a date, or an iso date-time with offset | `"2026-11-18T09:30-08:00"` |
| `url` | starts with `http://` or `https://` | `"https://x.com/someone"` |
| `enum` | one of the field's `options` | `"open"` |
| `lifts` | `exercise: sets; exercise: sets`. a set is `weightxreps`; `bw` is bodyweight, `+25` is bodyweight plus 25, `50x8x3` is three sets of 50x8. weights in the field's unit (lb) | `"flat db press: 45x10, 50x8, 60x6; pull up: bwx10, +25x6"` |

`lifts` are normalized on the way in (lowercase names, `×` becomes `x`, `50x8x3` expanded). fields marked `required` must be present on create. send `null` or `""` in a PATCH to clear a field.

## endpoints

| method | path | body | returns |
|---|---|---|---|
| GET | `/api` | | tabs, counts, field types, view kinds |
| GET | `/api/<tab>?q=<text>&limit=<n>&offset=<n>` | | `{ "rows": [...], "next_offset": <n> or null }`, in the tab's sort order. `q` matches any value. `limit` 100 by default, max 1000. to read everything, repeat with `offset=next_offset` until it is `null` |
| GET | `/api/<tab>/<id>` | | `{ "row": {...} }` |
| GET | `/api/<tab>/<id>/series` | | `{ "series": { "heart rate": { "unit": "bpm", "points": [[minute, value], ...] }, ... } }`: a row's intraday detail (a health day), minutes from that day's local midnight; `{}` when there is none |
| POST | `/api/<tab>` | `{ "<field>": value, ... }` | `201 { "row": {...} }` |
| PATCH | `/api/<tab>/<id>` | only the fields to change | `{ "row": {...} }` |
| DELETE | `/api/<tab>/<id>` | | `{ "deleted": <id> }` |
| GET | `/api/_tabs/<slug>` | | `{ "tab": {...} }` |
| PUT | `/api/_tabs/<slug>` | a full definition, plus optional `"after": "<slug>"` to sit right after that tab on the home page | `201` created or `200` replaced |
| DELETE | `/api/_tabs/<slug>` | | `{ "deleted": "<slug>" }`; `409` while it has rows |
| GET | `/api/_log?limit=<n>` | | schema changes: `{ at, by, tab, before, after }`, newest first |
| GET | `/api/_docs` | | this document, as markdown |

every row also has `id`, `created_at`, `updated_at` and `updated_by` (an email, or `service:<client-id>`). you can't set those.

## the tabs today

- **training**: one row per session. `at`, `type` (strength, run, hike, climb, other), `title`, `lifts`, `distance_km`, `duration_min`, `rpe`, `notes`. a new exercise needs nothing special: write it in `lifts`, and it appears in progress once it has two sessions. reuse an exercise's existing name (look at recent rows) so its history stays in one line.
- **body**: one row per weigh-in. `at`, `bodyweight_kg`, `bodyfat_percentage`, `notes`. a weigh-in is its own row, never part of a training row.
- **people**: `name`, `company`, `title`, `met_where`, `met_date`, `location`, `linkedin`, `twitter`, `referred_by`, `notes`, `group` (free text: the topic they belong to), `last_contact`. set `group` when adding someone, reusing a topic that's already in use (look at existing rows) when one fits; a new topic just appears on the page. set `last_contact` to today whenever they're mentioned as talked to.
- **books**: `title`, `author`, `status` (to read, reading, finished, dropped), `recommended_by`, `started`, `finished`, `take`, `quotes`, `link`. one row per book, for its whole life: a recommendation is a new row with `status: to read` and `recommended_by` (a name, a podcast, wherever it came from); starting it, finishing it or giving up is a PATCH to the same row (`status` plus `started` or `finished` as today). search first (`GET /api/books?q=<title>`) so a book is never added twice. `take` is what adhi thinks after a conversation about it: his claims and what he'd argue with, in his words, not a transcript and not a summary of the book. a later conversation adds to `take` instead of replacing it. the page opens on what's being read and what's next.
- **health**: one row per day, written by the hourly garmin sync, not by agents (read it, don't write it). numbers by section: recovery (`resting_hr`, `min_hr`, `max_hr`, `hrv_ms` and its baseline, stress minutes, body battery high, low, at wake and during sleep), sleep (`sleep_min` and its stages, `sleep_score`, `sleep_need_min`, `bedtime`, `wake_time`, respiration), activity (`steps`, `intensity_min`, `active_min`, `sedentary_min`, calories), fitness (`vo2max`, `fitness_age`, `weight_kg`). text fields ending in `_feedback`, `_insight` or `_qualifier` are garmin's own verdicts as words. a day's heart rate every 2 minutes, overnight hrv and body battery: `GET /api/health/<id>/series` (garmin keeps these about 4 months, so older days have none). the page opens on one line per metric judging the newest day against your usual (the same words an agent should use: "7 bpm below usual", "2h short of what you needed"), and lists each day as its big picture ("short night, well recovered"). `GET /api/_tabs/health` lists every field; how it all works: `docs/health.md` in the repo.
- **forecasts**: `date`, `decision`, `rationale`, `confidence` (0-100), `expected`, `review_date`, `outcome`, `verdict` (right, wrong), `status` (open, closed). scoring one = PATCH `verdict` and `status: closed`.

## changing the schema

adding a tab or a column is a `PUT`, with no migration and no deploy. to add a column: `GET /api/_tabs/<slug>`, append to `fields`, `PUT` the whole definition back (without `slug` and `position`). existing rows just lack the new field. removing a field hides it; stored values stay. every change is logged.

a definition, with every key:

```json
{
  "label": "body", "about": "weigh-ins and measurements",
  "title": "at", "aside": ["bodyweight_kg"], "line": [], "sort": "at",
  "snippet": "notes",
  "group": "at",
  "views": [{ "kind": "line", "field": "bodyweight_kg" }],
  "fields": [
    { "name": "at", "type": "datetime", "required": true },
    { "name": "bodyweight_kg", "type": "number", "min": 20, "max": 300, "unit": "kg" },
    { "name": "notes", "type": "text" }
  ]
}
```

- `title`, `aside`, `line`: how a row reads in the list. `snippet`: a text field previewed under each row. enums show as a white pill; an enum field's `colors` gives a value an outlined pill instead: `"outline"` (white border), `"good"` (green) or `"bad"` (red), e.g. `{ "closed": "outline", "right": "good", "wrong": "bad" }`.
- `section` on a field puts it under that heading on a row's page; `parts` (`[{ "label": "sleep", "fields": [...] }]`) draws those number fields as shares of one bar there.
- `hidden: true` keeps a tab out of the nav and off home; its rows still feed other tabs' views (body feeds training's lines).
- `sort`: `"id"` (newest first) or a field (largest first). `group`: a date field groups the list by day; a text or enum field groups it by value, collapsed.
- no targets or thresholds go in a definition (no goal weight, no sessions a week, no "after 60 days"): views show what happened and compare it with your own history, so nothing needs updating as plans change.
- slugs are lowercase letters, digits and hyphens. field names are snake_case. `id`, `created_at`, `updated_at` and `updated_by` are reserved.

## views

what a tab opens on, above its list. green means good and red means bad; everything else is grey.

| kind | shows | keys |
|---|---|---|
| `progress` | each exercise's best set, green if the latest is the best, red if it's below, with a box of its last 14 sessions as dots and a line on the right; the name opens the exercise's page: a zoomable chart, one dot per session (a click opens it), the best in green | `field` (a lifts field) |
| `strip` | a tick per day that has a row, from the first row (at most `days` back, default 182) to today; how many a week, and how long since the last, red once that gap is longer than any before | `field` (a date field), `label` ("sessions"), `days` |
| `line` | a number over time: the latest, the change since the first, and a zoomable chart of every day since the first (10d / 1m / 3m / 1y / all, pinch and drag; a click on a dot opens that row); `tab` reads another tab | `field`, `tab` |
| `upcoming` | the next `limit` (default 3) rows matching `where` by a date, soonest first, overdue in red. a past date on a row under it reads "reviewed …" once the row stops matching `where`, "review overdue by …" while it still does | `field`, `where`, `limit` |
| `list` | the rows matching `where` under the heading `label`, largest `sort` first (empty last), or in the tab's order without one; `aside` shows one field at the right, a date as "2 weeks ago". nothing is ever red: a row waiting for a year is not late | `label`, `where`, `sort`, `aside` |
| `metrics` | one line per metric judging one day against your usual, by fixed rules: the newest day (the newest finished day with `finished`, today shown as "so far"); a tab whose newest day isn't today (where you are) shows dates instead of today / yesterday and judges no "so far". the usual band is the middle half (25th to 75th percentile) of the 28 days before it, from 10 of them. inside it reads "about usual"; outside, how far from the middle ("3 above usual", "12% below usual" once the usual is in the thousands) or "highest / lowest in 3 months" when it beats the 90 days before. `need` judges against a field holding the day's own target instead ("2h short of what you needed"); `clock` adds a datetime field's time against your usual ("in bed 1:10am, 40m later than usual"); `change` says how a slow number moved over the months instead. green or red only outside the band, by `better`. on the right, a box of the last 14 days as dots and a line, the band shaded, the judged day white. the row opens the metric's page: the same sentence and your usual, then a zoomable chart (1d / 3d of the `stream` series when there is one, then 10d to all of the days), your usual as dashed lines, the best week in green; a click on a dot opens that day. `good` / `bad`: the words a day earns in the tab's list when this metric is outside its usual that way; the list shows at most two, bad first, or "an ordinary day" | `label`, `metrics: [{ field, better, finished, need, clock, change, stream, good, bad }]` (all but field optional) |
| `calibration` | what you said on average against how many came true, from the first scored row; each confidence level on its own once `min` (default 10) are scored | `confidence`, `verdict`, `right`, `min` |

## errors

an html page instead of json (a 403 with "error 1010", or a challenge page) means cloudflare refused the request before it reached the api: nothing was read or written, retrying won't help, and adhi has to change a cloudflare setting.

errors come back as `{ "error": "<what to fix>" }`: `400` names the field and the problem, `401` not signed by access, `403` this token may not read data, `404` no such tab or row (a bad tab name lists the real ones), `405` wrong method, `409` deleting a tab that still has rows.

## examples

```bash
H=(-H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET")
curl -s "${H[@]}" https://seniorintern.adhikrish.cloud/api
curl -s "${H[@]}" -X POST -H "content-type: application/json" \
  -d '{"at":"2026-11-18T18:00-08:00","type":"strength","title":"chest","lifts":"flat db press: 50x8, 55x8, 60x6; tricep pushdown: 50x8x3","duration_min":60}' \
  https://seniorintern.adhikrish.cloud/api/training
curl -s "${H[@]}" -X POST -H "content-type: application/json" -d '{"at":"2026-11-18","bodyweight_kg":69.2}' \
  https://seniorintern.adhikrish.cloud/api/body
curl -s "${H[@]}" -X PATCH -H "content-type: application/json" -d '{"verdict":"right","status":"closed"}' \
  https://seniorintern.adhikrish.cloud/api/forecasts/2
```

## instructions to give the agent

paste this into the dot's instructions, with the two values from 1password:

> you keep my senior intern database at https://seniorintern.adhikrish.cloud. send CF-Access-Client-Id: <client-id> and CF-Access-Client-Secret: <client-secret> on every request.
> 1. start with GET /api. it lists the tabs, their fields and the formats. read it first; tabs change.
> 2. one thing that happened = one row in the tab it belongs to. a session goes in training, a weigh-in in body, a new person in people, a prediction in forecasts, a book in books.
> 3. training: write lifts as "exercise: 45x10, 50x8; pull up: bwx10, +25x6" (weights in lb, bw = bodyweight, +25 = added). reuse the exercise names already in recent training rows.
> 4. people: search first (GET /api/people?q=<name>) and update instead of duplicating. set group to a topic, reusing an existing one when it fits; set last_contact to today when i say i talked to someone.
> 5. forecasts: always set confidence (0-100) and review_date. when i say how one turned out, set verdict and status closed.
> 6. books: one row per book. a recommendation is status "to read" with recommended_by; starting, finishing or dropping it is a PATCH to that row. search first. after we talk about a book i finished, write my take in my words (what i claim, what i'd argue with), adding to any take already there.
> 7. if i ask you to track something new, add a tab or a column: GET /api/_tabs/<slug>, change it, PUT it back. never delete a tab, field or row unless i ask.
> 8. if you get a 400, the error says what to fix; fix it and retry once.
> 9. never put these headers or values in a message, a file or a page.
> 10. the full contract is GET /api/_docs (same headers). read it before your first write, and again when an error or a new kind of request leaves you unsure.
