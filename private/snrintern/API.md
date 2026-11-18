# snr intern api

base url: `https://snrintern.adhikrish.cloud`. the agent writes through this api; the pages are read-only. everything a page shows comes from rows and tab definitions, so new tabs, columns, exercises and charts need no code change.

## auth

send both headers on every request. the values are in 1password: `Personal › snrintern dots token`.

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
| GET | `/api/<tab>?q=<text>&limit=<n>` | | `{ "rows": [...] }`, in the tab's sort order. `q` matches any value. `limit` 100 by default, max 1000 |
| GET | `/api/<tab>/<id>` | | `{ "row": {...} }` |
| POST | `/api/<tab>` | `{ "<field>": value, ... }` | `201 { "row": {...} }` |
| PATCH | `/api/<tab>/<id>` | only the fields to change | `{ "row": {...} }` |
| DELETE | `/api/<tab>/<id>` | | `{ "deleted": <id> }` |
| GET | `/api/_tabs/<slug>` | | `{ "tab": {...} }` |
| PUT | `/api/_tabs/<slug>` | a full definition | `201` created or `200` replaced |
| DELETE | `/api/_tabs/<slug>` | | `{ "deleted": "<slug>" }`; `409` while it has rows |
| GET | `/api/_log?limit=<n>` | | schema changes: `{ at, by, tab, before, after }`, newest first |
| GET | `/api/_docs` | | this document, as markdown |

every row also has `id`, `created_at`, `updated_at` and `updated_by` (an email, or `service:<client-id>`). you can't set those.

## the tabs today

- **training**: one row per session. `at`, `type` (strength, run, hike, climb, other), `title`, `lifts`, `distance_km`, `duration_min`, `rpe`, `notes`. a new exercise needs nothing special: write it in `lifts`, and it appears in progress once it has two sessions. reuse an exercise's existing name (look at recent rows) so its history stays in one line.
- **body**: one row per weigh-in. `at`, `bodyweight_kg`, `bodyfat_percentage`, `notes`. a weigh-in is its own row, never part of a training row.
- **people**: `name`, `company`, `title`, `met_where`, `met_date`, `location`, `linkedin`, `twitter`, `referred_by`, `notes`, `group` (free text: the topic they belong to), `last_contact`. set `group` when adding someone, reusing a topic that's already in use (look at existing rows) when one fits; a new topic just appears on the page. set `last_contact` to today whenever they're mentioned as talked to.
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
- `hidden: true` keeps a tab out of the nav and off home; its rows still feed other tabs' views (body feeds training's lines).
- `sort`: `"id"` (newest first) or a field (largest first). `group`: a date field groups the list by day; a text or enum field groups it by value, collapsed.
- no targets or thresholds go in a definition (no goal weight, no sessions a week, no "after 60 days"): views show what happened and compare it with your own history, so nothing needs updating as plans change.
- slugs are lowercase letters, digits and hyphens. field names are snake_case. `id`, `created_at`, `updated_at` and `updated_by` are reserved.

## views

what a tab opens on, above its list. green means good and red means bad; everything else is grey.

| kind | shows | keys |
|---|---|---|
| `progress` | each exercise's best set over time, green if the latest is the best, red if it's below | `field` (a lifts field) |
| `strip` | a tick per day that has a row, from the first row (at most `days` back, default 182) to today; how many a week, and how long since the last, red once that gap is longer than any before | `field` (a date field), `label` ("sessions"), `days` |
| `line` | a number over time: the latest, the change since the first, a line; `tab` reads another tab | `field`, `tab` |
| `upcoming` | the next `limit` (default 3) rows matching `where` by a date, soonest first, overdue in red. a past date on a row under it reads "reviewed …" once the row stops matching `where`, "review overdue by …" while it still does | `field`, `where`, `limit` |
| `calibration` | what you said on average against how many came true, from the first scored row; each confidence level on its own once `min` (default 10) are scored | `confidence`, `verdict`, `right`, `min` |
| `stale` | the `limit` (default 3) rows whose date is oldest: who you've gone longest without | `field`, `limit`, `label` |

## errors

errors come back as `{ "error": "<what to fix>" }`: `400` names the field and the problem, `401` not signed by access, `403` token may only call /health, `404` no such tab or row (a bad tab name lists the real ones), `405` wrong method, `409` deleting a tab that still has rows.

## examples

```bash
H=(-H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET")
curl -s "${H[@]}" https://snrintern.adhikrish.cloud/api
curl -s "${H[@]}" -X POST -H "content-type: application/json" \
  -d '{"at":"2026-11-18T18:00-08:00","type":"strength","title":"chest","lifts":"flat db press: 50x8, 55x8, 60x6; tricep pushdown: 50x8x3","duration_min":60}' \
  https://snrintern.adhikrish.cloud/api/training
curl -s "${H[@]}" -X POST -H "content-type: application/json" -d '{"at":"2026-11-18","bodyweight_kg":69.2}' \
  https://snrintern.adhikrish.cloud/api/body
curl -s "${H[@]}" -X PATCH -H "content-type: application/json" -d '{"verdict":"right","status":"closed"}' \
  https://snrintern.adhikrish.cloud/api/forecasts/2
```

## instructions to give the agent

paste this into the dot's instructions, with the two values from 1password:

> you keep my snr intern database at https://snrintern.adhikrish.cloud. send CF-Access-Client-Id: <client-id> and CF-Access-Client-Secret: <client-secret> on every request.
> 1. start with GET /api. it lists the tabs, their fields and the formats. read it first; tabs change.
> 2. one thing that happened = one row in the tab it belongs to. a session goes in training, a weigh-in in body, a new person in people, a prediction in forecasts.
> 3. training: write lifts as "exercise: 45x10, 50x8; pull up: bwx10, +25x6" (weights in lb, bw = bodyweight, +25 = added). reuse the exercise names already in recent training rows.
> 4. people: search first (GET /api/people?q=<name>) and update instead of duplicating. set group to a topic, reusing an existing one when it fits; set last_contact to today when i say i talked to someone.
> 5. forecasts: always set confidence (0-100) and review_date. when i say how one turned out, set verdict and status closed.
> 6. if i ask you to track something new, add a tab or a column: GET /api/_tabs/<slug>, change it, PUT it back. never delete a tab, field or row unless i ask.
> 7. if you get a 400, the error says what to fix; fix it and retry once.
> 8. never put these headers or values in a message, a file or a page.
> 9. the full contract is GET /api/_docs (same headers). read it before your first write, and again when an error or a new kind of request leaves you unsure.
