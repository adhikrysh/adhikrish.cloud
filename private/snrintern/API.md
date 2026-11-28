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

`GET /api` returns every tab with its definition and row count, plus the field types and view kinds. tabs change, so read it before writing and never hard-code the list.

`GET /api/<tab>/_views` returns every view of the tab as numbers and verdicts: health's judged metrics ("sleep score 84, good"), training's sessions, load, run limit, weeks, lift progress and records. it's computed at the moment you ask, by the code that would draw it. training's load, run limit and weeks are for you only (`page: false`): no page shows them, so `/_views` is the one place they exist. `on_page` says which views a page also draws. start here when you need to know how things stand; read rows only for the detail behind a number (a session's notes, one run's splits). don't redo its arithmetic from rows. this document itself is `GET /api/_docs`, served by the same deploy as the code, so it always describes what is running.

## field types

| type | accepts | example |
|---|---|---|
| `text` | any string | `"met at the demo night"` |
| `int` | a whole number; optional `min`, `max`, `unit` | `62` |
| `number` | a decimal; optional `min`, `max`, `unit` | `68.4` |
| `date` | `yyyy-mm-dd` | `"2026-11-18"` |
| `datetime` | a date, or an iso date-time with offset; with `time: true` the time and offset are required | `"2026-11-18T09:30-08:00"` |
| `url` | starts with `http://` or `https://` | `"https://x.com/someone"` |
| `enum` | one of the field's `options` | `"open"` |
| `ref` | the title of a row in the tab named by `to` (a company's name); with `many: true`, a list of titles. see links below | `"Acme"`, `["Ada Lovelace", "Ben Sample"]` |
| `lifts` | `exercise: sets; exercise: sets`. a set is `weightxreps`; `bw` is bodyweight, `+25` is bodyweight plus 25, `50x8x3` is three sets of 50x8. weights in the field's unit (lb) | `"flat db press: 45x10, 50x8, 60x6; pull up: bwx10, +25x6"` |

`lifts` are normalized on the way in (lowercase names, `×` becomes `x`, `50x8x3` expanded). fields marked `required` must be present on create. send `null` or `""` (or `[]` for a list) in a PATCH to clear a field.

### links

a `ref` links one row to another by name, the way a wiki links pages. a person's `company` is `"Acme"`, and Acme is a row in companies. you always write and read names, never ids.

- **write a name, get the row.** `"acme"` matches the row titled "Acme" (case doesn't matter) and is stored as `"Acme"`. a name with no row creates it: write `company: "Orbital Labs"` and companies gains Orbital Labs. so spell a name the way it's already written (search first) or you get a second node.
- **one title, one row.** a tab that links point into refuses a second row with a title it already has (`409`, naming the row to patch instead). two people with the same name need their full names.
- **renames follow.** changing a row's title rewrites every link to it.
- **links hold a row.** deleting a row something links to is refused (`409`, saying what links to it); unlink those first.
- a person never links to themself: their own name in their `knows` is dropped.

## endpoints

| method | path | body | returns |
|---|---|---|---|
| GET | `/api` | | tabs, counts, field types, view kinds |
| GET | `/api/<tab>?q=<text>&limit=<n>&offset=<n>` | | `{ "rows": [...], "next_offset": <n> or null }`, in the tab's sort order. `q` matches any value. `limit` 100 by default, max 1000. to read everything, repeat with `offset=next_offset` until it is `null` |
| GET | `/api/<tab>/<id>` | | `{ "row": {...} }` |
| GET | `/api/<tab>/_views` | | `{ "views": [{ "kind", "label", ...its numbers }] }`: each view on the tab's page that has something to say, in page order (see views) |
| GET | `/api/<tab>/<id>/series` | | `{ "series": { "heart rate": { "unit": "bpm", "points": [[minute, value], ...] }, ... } }`: a row's intraday detail (a health day), minutes from that day's local midnight; `{}` when there is none |
| POST | `/api/<tab>` | `{ "<field>": value, ... }` | `201 { "row": {...} }`; in training, `200 { "row": {...}, "merged": "garmin" }` when the session is one the watch already stored (see training below) |
| PATCH | `/api/<tab>/<id>` | only the fields to change | `{ "row": {...} }` |
| DELETE | `/api/<tab>/<id>` | | `{ "deleted": <id> }`; `409` while another row links to it |
| GET | `/api/_tabs/<slug>` | | `{ "tab": {...} }` |
| PUT | `/api/_tabs/<slug>` | a full definition, plus optional `"after": "<slug>"` to sit right after that tab on the home page | `201` created or `200` replaced |
| DELETE | `/api/_tabs/<slug>` | | `{ "deleted": "<slug>" }`; `409` while it has rows |
| GET | `/api/_log?limit=<n>` | | schema changes: `{ at, by, tab, before, after }`, newest first |
| GET | `/api/_docs` | | this document, as markdown |

every row also has `id`, `created_at`, `updated_at` and `updated_by` (an email, or `service:<client-id>`). you can't set those.

## the tabs today

every tab's title is plain; the one-line descriptions carry the names: people is "sonder", predictions "receipts", training "entropy", reccos "conversations with the dead", and obsessions and health have live ones (see `live` below). home lists them in this order: obsessions, training, health, people, predictions, reccos.

- **training**: one row per session, from you and from the watch. you write `at` (the start, with time and offset: `2026-11-18T18:00-08:00`; a date alone is refused), `type` (strength, run, hike, climb, swim, ride, sport, other), `title`, `focus`, `lifts`, `rpe`, `notes`. a new exercise needs nothing special: write it in `lifts`, and it appears in progress once it has two sessions. reuse an exercise's existing name (look at recent rows) so its history stays in one line. the page opens on sessions, lift progress, bodyweight and records; load, the run limit and weeks per sport are yours alone. all of them: `GET /api/training/_views`.
  the hourly sync brings in every garmin activity (runs, gym, hikes, swims, rides, sports) and merges it with your rows: a garmin activity and your row are one session when they start within 2 hours of each other on the same day. garmin owns what the watch measures (`at`, `duration_min`, `distance_km`, `avg_hr`, `training_load`, `training_effect`, heart rate zones, splits, `watch_rpe` and `watch_feel` as you entered them on the watch, `garmin_id`...); you own `focus`, `lifts`, `rpe` and `notes`. `type` and `title` are yours, but garmin fills them when a row has none. neither side overwrites the other. so: log a session the way you always do. if the watch already has it, your POST lands on that row and the answer says `"merged": "garmin"`; don't post it again. never write garmin's fields; your measurement of distance or time yields to the watch's. a second session close to one you already wrote to gets its own row.
- **body**: one row per weigh-in. `at`, `bodyweight_kg`, `bodyfat_percentage`, `notes`. a weigh-in is its own row, never part of a training row. weigh-ins on garmin (a scale, or typed into garmin connect) come in with the sync, one per day, and merge with yours on the same day; the scale's numbers win.
- **people**: `name`, `title`, `met_date`, `location`, `linkedin`, `twitter`, `notes`, `group` (free text: the topic they belong to), `last_contact`, and four links: `company` (a row in companies), `met_where` (a row in events: the meetup, conference or intro where you met), `referred_by` (a person) and `knows` (a list of people). set `group` when adding someone, reusing a topic that's already in use (look at existing rows) when one fits; a new topic just appears on the page. set `last_contact` to today whenever they're mentioned as talked to. the links are the graph the page opens on, so fill them whenever you hear them: who introduced whom, who knows whom, where you met. `GET /api/people/_views` returns the whole graph: `nodes` (`{ id, tab, row, label, data }`) and `edges` (`{ from, to, field }`); read it to answer "who do i know at X" or "who could introduce me to Y".
- **companies** and **events**: what people link to. companies: `name`, `about`, `url`, `notes`. events: `name`, `date`, `place`, `notes`. a link creates the row with just its name; fill in the rest when you learn it. neither has its own page in the nav; they're nodes in people's graph.
- **reccos**: recommendations of any kind. `title`, `kind` (book, movie, show, podcast, article), `creator` (author, director, host), `status` (next, on it, finished, dropped), `recommended_by`, `link`. one row per thing, for its whole life: a recommendation is a new row with `status: next` and `recommended_by` (a name, a podcast, wherever it came from); starting it, finishing it or giving up is a PATCH of `status` on the same row. no dates and no notes: thoughts about it go in adhi's second brain, not here. search first (`GET /api/reccos?q=<title>`) so nothing is added twice. the page opens on a card per thing that's on it or next; `GET /api/reccos/_views` gives the same cards as data.
- **obsessions**: what adhi lives for: the things he gets up for, not tasks to finish. `obsession`, `why`. one row each; add one only when he names it as one.
- **health**: one row per day, written by the hourly garmin sync, not by agents (read it, don't write it). numbers by section: recovery (`resting_hr`, `min_hr`, `max_hr`, `hrv_ms` and its baseline, stress minutes, body battery high, low, at wake and during sleep), sleep (`sleep_min` and its stages, `sleep_score` and garmin's `sleep_score_label`, `sleep_need_min`, `bedtime`, `wake_time`, respiration), activity (`steps`, `step_goal`, `intensity_min`, `intensity_goal` (weekly), `active_min`, `sedentary_min`, calories), fitness (`vo2max`, `fitness_age`); weight is in body. text fields ending in `_feedback`, `_insight` or `_qualifier` are garmin's own verdicts as words. a day's heart rate every 2 minutes, overnight hrv and body battery: `GET /api/health/<id>/series` (garmin keeps these about 4 months, so older days have none). the page and `GET /api/health/_views` judge each metric's newest day with garmin's own verdict where garmin has one (sleep score label, hrv status, its body battery and stress bands, its step and intensity goals) and your own history only for resting hr; the page lists each day as its big picture ("poor sleep, well recovered"). use the same words when you talk about it. `GET /api/_tabs/health` lists every field; how it all works: `docs/health.md` in the repo.
- **predictions** (was forecasts): `date`, `decision`, `rationale`, `confidence` (0-100), `expected`, `review_date`, `outcome`, `verdict` (right, wrong), `status` (open, closed). scoring one = PATCH `verdict` and `status: closed`.

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
- `time: true` on a datetime field refuses a date without a time (training's `at`: a session's start is what matches it to the watch).
- `to` on a `ref` field names the tab it links to (it must exist, or be the tab itself); `many: true` makes it a list.
- `hidden: true` on a field keeps it off the pages (training's `garmin_id`); the api still has it.
- `live` on a tab makes its description (`about`) a number about adhi's life, worked out on every request from his birthday (a worker secret, not data): `"weeks_left"` (4,000 weeks minus the weeks lived: "2780.29 weeks", health) or `"felt_time_left"` (the share of life left as it feels, if a year at age t feels like 1/t, counting from age 7: "49.62% of perceptive time", obsessions). the title never changes. `GET /api` lists every tab with its description as home shows it; `GET /api/_tabs/<slug>` returns the definition as written.
- `hidden: true` on a tab keeps it out of the nav and off home; its rows still feed other tabs' views (body feeds training's lines).
- `sort`: `"id"` (newest first) or a field (largest first). `group`: a date field groups the list by day; a text or enum field groups it by value, collapsed.
- no targets or thresholds we invent go in a definition (no goal weight, no sessions a week, no "after 60 days"). a verdict comes from the source of truth (garmin's own label, its published bands, its goal stored on the row, a clinical bound) or from the number's own history.
- slugs are lowercase letters, digits and hyphens. field names are snake_case. `id`, `created_at`, `updated_at` and `updated_by` are reserved.

## views

what a tab opens on, above its list, and what `GET /api/<tab>/_views` returns. `"page": false` on a view keeps it off the page (numbers for the agents only). green means good and red means bad; everything else is grey.

| kind | shows | keys |
|---|---|---|
| `progress` | each exercise's best set, green if the latest is the best, red if it's below, with a box of its last 14 sessions as dots and a line on the right; the name opens the exercise's page: a zoomable chart, one dot per session (a click opens it), the best in green | `field` (a lifts field) |
| `strip` | a tick per day that has a row, from the first row (at most `days` back, default 182) to today; how many a week, and how long since the last, red once that gap is longer than any before | `field` (a date field), `label` ("sessions"), `days` |
| `line` | a number over time: the latest, the change since the first, and a zoomable chart of every day since the first (10d / 1m / 3m / 1y / all, pinch and drag; a click on a dot opens that row); `tab` reads another tab | `field`, `tab` |
| `upcoming` | the next `limit` (default 3) rows matching `where` by a date, soonest first, overdue in red. a past date on a row under it reads "reviewed …" once the row stops matching `where`, "review overdue by …" while it still does | `field`, `where`, `limit` |
| `list` | the rows matching `where` under the heading `label`, largest `sort` first (empty last), or in the tab's order without one; `aside` shows one field at the right, a date as "2 weeks ago". nothing is ever red: a row waiting for a year is not late | `label`, `where`, `sort`, `aside` |
| `metrics` | one line per metric: the judged day's value, one short verdict, and a box of its last 14 days (dots and a line). the judged day is the newest (the newest finished day with `finished`, today shown as "so far"); a tab whose newest day isn't today where you are shows dates instead. the verdict comes from the closest thing to a source of truth, in this order: `label` (garmin's own word for the day, from a text field; `good` / `bad` list which words colour), `scale` (garmin's published bands: `[{ upTo, word, tone }]`), `goal` (a field with garmin's goal for the day, or the week with `per: "week"`: "goal met", "627 short of goal", "280 of 150 min this week"), `change` (a slow number: "up 1.1 in 3 months"), else your own history: "higher" or "lower than usual" when outside the 10th to 90th percentile of the 28 days before (needs 14), shaded as a band in the box, coloured by `better`, with `limit` a clinical bound above which a day is always bad. green is good, red is bad. the row opens the metric's page: the value and its verdict, then a zoomable chart (1d / 3d of the `stream` series when there is one, then 10d to all of the days; your usual as dashed lines where the verdict is your own history; the best week in green when `better` is set); a click on a dot opens that day. `log: { good, bad }`: the words a day earns in the tab's list when this metric judges it good or bad; the list shows at most two, bad first, or "an ordinary day" | `label`, `metrics: [{ field, better, finished, change, stream, limit, per, goal, label, scale, log }]` (all but field optional) |
| `load` | the last 7 days' total of `field` (garmin's training load per session) and the 4-week average a week; "higher" or "lower than usual" when the 7 days sit outside the 10th to 90th percentile of your own past weeks (8 or more, up to a year), else "usual". never coloured, and never a ratio: the acute:chronic ratio and its 0.8 to 1.3 "sweet spot" don't hold up (docs/training.md). the box: the last 12 weeks. json: `last_7_days`, `per_week_last_28_days`, `verdict`, `usual_week`, `weeks` | `field`, `label` |
| `limit` | the longest session matching `where` in the last `days` (30) and the next one's limit, `over` (10) % past it; every session in those days that went past the longest of the `days` before it, in red. from a 2025 study of 5,200 garmin runners (Frandsen et al., BJSM): a run over 10% longer than the longest of the 30 days before raised overuse injuries. json: `longest`, `next_under`, `over_the_limit` | `field`, `where`, `days`, `over`, `label` |
| `weeks` | per value of `by` (sport) done in the last 4 weeks: the first of `fields` (time) this week, the rest beside it, and a box of `weeks` (12) 7-day weeks; `zones` as shares of one bar over the last 28 days. a sport done this week with no time on any session (a gym day logged without the watch) reads "no time logged". json: every sport's weekly `sessions` and sums, oldest first, and `zones_last_28_days` | `by`, `fields`, `zones`, `weeks`, `label` |
| `records` | each record's best in the last `days` (90) next to its best ever (`best: "max"`, or `"min"` for times), each opening its session; green when the recent one is the best ever. a record with no rows at all is left out. json: `best_ever` and `best_last_<days>_days`, each `{ value, shown, on, id }` | `records: [{ label, field, best, where }]`, `days`, `label` |
| `graph` | (no heading on the page) the tab's rows and the rows its links reach (people, companies, events) as a graph you can drag, pan and zoom; a click on a node shows its fields and what it links to, and fades the rest. json: `tabs`, `nodes` (`{ id, tab, row, label, data }`) and `edges` (`{ from, to, field }`) | `label` ("connections") |
| `cards` | (no heading on the page unless it has a `label`) a card per row whose enum `field` is one of `show`, grouped in that order, the first group outlined: the title and `sub` on top, `foot` bottom left, a picture of the enum `icon` bottom right (book, movie, show, podcast, article). json: `rows` (`{ id, title, <field>, <sub>, <foot>, <icon> }`) | `field`, `show` (`["on it", "next"]`), `sub`, `foot`, `icon`, `label` |
| `calibration` | what you said on average against how many came true, from the first scored row; each confidence level on its own once `min` (default 10) are scored | `confidence`, `verdict`, `right`, `min` |

## errors

an html page instead of json (a 403 with "error 1010", or a challenge page) means cloudflare refused the request before it reached the api: nothing was read or written, retrying won't help, and adhi has to change a cloudflare setting.

errors come back as `{ "error": "<what to fix>" }`: `400` names the field and the problem, `401` not signed by access, `403` this token may not read data, `404` no such tab or row (a bad tab name lists the real ones), `405` wrong method, `409` a title that's already taken, a row something links to, or a tab that still has rows.

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
  https://seniorintern.adhikrish.cloud/api/predictions/2
```

## instructions to give the agent

paste this into the dot's instructions, with the two values from 1password:

> you keep my senior intern database at https://seniorintern.adhikrish.cloud. send CF-Access-Client-Id: <client-id> and CF-Access-Client-Secret: <client-secret> on every request.
> 1. start with GET /api. it lists the tabs, their fields and the formats. read it first; tabs change. for how things stand (health, training), read GET /api/<tab>/_views: the verdicts and numbers, computed for you. don't recompute them from rows.
> 2. one thing that happened = one row in the tab it belongs to. a session goes in training, a weigh-in in body, a new person in people, a prediction in predictions, a recommendation (book, movie, show, podcast) in reccos.
> 3. training: write lifts as "exercise: 45x10, 50x8; pull up: bwx10, +25x6" (weights in lb, bw = bodyweight, +25 = added). reuse the exercise names already in recent training rows. always give at a start time with its offset; ask me if you don't know it. the watch's sessions arrive on their own: log yours anyway, and they merge.
> 4. people: search first (GET /api/people?q=<name>) and update instead of duplicating. set group to a topic, reusing an existing one when it fits; set last_contact to today when i say i talked to someone. company, met_where, referred_by and knows are links by name: write the name exactly as it's already spelled (search companies, events, people first); a new name creates the row. whenever i mention who introduced or knows whom, or where we met, add it.
> 5. predictions: always set confidence (0-100) and review_date. when i say how one turned out, set verdict and status closed.
> 6. reccos: one row per recommendation, with its kind (book, movie, show, podcast, article). a new one is status "next" with recommended_by; starting, finishing or dropping it is a PATCH of status on that row. search first. no notes there: my thoughts go in my second brain.
> 7. if i ask you to track something new, add a tab or a column: GET /api/_tabs/<slug>, change it, PUT it back. never delete a tab, field or row unless i ask.
> 8. if you get a 400, the error says what to fix; fix it and retry once.
> 9. never put these headers or values in a message, a file or a page.
> 10. the full contract is GET /api/_docs (same headers). read it before your first write, and again when an error or a new kind of request leaves you unsure.
