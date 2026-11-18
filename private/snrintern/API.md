# snr intern api

base url: `https://snrintern.adhikrish.cloud`. the agent writes; the pages read the same data. everything a page shows comes from rows and tab definitions, so new tabs, columns, exercises and charts need no code change.

## auth

send both headers on every request. the values are in 1password: `Personal › snrintern dots token`.

```
CF-Access-Client-Id: <client-id>
CF-Access-Client-Secret: <client-secret>
```

cloudflare access checks them before the request reaches the worker. without them you get a 302 to a login page. a token that isn't on the agent list (`AGENT_CLIENT_IDS`) gets `403`.

## discover first

`GET /api` returns every tab with its definition and row count, plus the field types and view kinds. tabs change, so read it before writing and never hard-code the list.

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

every row also has `id`, `created_at`, `updated_at` and `updated_by` (an email, or `service:<client-id>`). you can't set those.

## the tabs today

- **training**: one row per session. `at`, `type` (strength, run, hike, climb, other), `title`, `focus` (muscle groups, comma-separated: legs, chest, back, shoulders, arms), `lifts`, `distance_km`, `duration_min`, `rpe`, `notes`. a new exercise needs nothing special: write it in `lifts`, and it appears in progress once it has two sessions. reuse an exercise's existing name (look at recent rows) so its history stays in one line.
- **body**: one row per weigh-in. `at`, `bodyweight_kg`, `bodyfat_percentage`, `notes`. a weigh-in is its own row, never part of a training row.
- **people**: `name`, `company`, `title`, `met_where`, `met_date`, `location`, `linkedin`, `twitter`, `referred_by`, `notes`, `group` (space & deep tech, investors & mentors, founder peers, hiring, other), `last_contact`. set `group` when adding someone; set `last_contact` to today whenever they're mentioned as talked to.
- **forecasts**: `date`, `decision`, `rationale`, `confidence` (0-100), `expected`, `review_date`, `outcome`, `verdict` (right, wrong), `status` (open, closed). scoring one = PATCH `verdict` and `status: closed`.

## changing the schema

adding a tab or a column is a `PUT`, with no migration and no deploy. to add a column: `GET /api/_tabs/<slug>`, append to `fields`, `PUT` the whole definition back (without `slug` and `position`). existing rows just lack the new field. removing a field hides it; stored values stay. every change is logged.

a definition, with every key:

```json
{
  "label": "body", "about": "weigh-ins and measurements",
  "title": "at", "aside": ["bodyweight_kg"], "line": [], "sort": "at",
  "snippet": "notes",
  "summary": ["type"],
  "group": "at",
  "goals": { "bodyweight_kg": 75 },
  "views": [{ "kind": "line", "field": "bodyweight_kg", "goal": "bodyweight_kg" }],
  "fields": [
    { "name": "at", "type": "datetime", "required": true },
    { "name": "bodyweight_kg", "type": "number", "min": 20, "max": 300, "unit": "kg" },
    { "name": "notes", "type": "text" }
  ]
}
```

- `title`, `aside`, `line`: how a row reads in the list. `snippet`: a text field previewed under each row. `summary`: enum fields counted under the heading.
- `sort`: `"id"` (newest first) or a field (largest first). `group`: a date field groups the list by day; an enum field groups it by value.
- `goals`: named numbers the views compare against.
- slugs are lowercase letters, digits and hyphens. field names are snake_case. `id`, `created_at`, `updated_at` and `updated_by` are reserved.

## views

what a tab opens on, above its list. green means good and red means bad; everything else is grey.

| kind | shows | keys |
|---|---|---|
| `progress` | each exercise's best set over time, green if the latest is the best, red if it's below | `field` (a lifts field) |
| `weekly` | sessions per week since the first row, against a goal; `mark` highlights rows containing a value (leg days) | `goal`, `mark: { field, contains, goal }` |
| `since` | how long since each value last appeared, red after two weeks | `field`, `values` |
| `line` | a number over time, green when moving toward the goal; `tab` reads another tab | `field`, `tab`, `goal` |
| `due` | rows whose date is within `within_days` (default 30) or overdue, with one-click buttons that set `score.field` plus `score.set` | `field`, `where`, `within_days`, `score: { field, set }` |
| `calibration` | how often each confidence level came true, once `min` (default 10) rows are scored | `confidence`, `verdict`, `right`, `min` |
| `stale` | rows whose date is older than `days`, oldest first | `field`, `days`, `label` |

the home page collects every tab's `due`, `stale` and `weekly` views.

## errors

errors come back as `{ "error": "<what to fix>" }`: `400` names the field and the problem, `401` not signed by access, `403` token may only call /health, `404` no such tab or row (a bad tab name lists the real ones), `405` wrong method, `409` deleting a tab that still has rows.

## examples

```bash
H=(-H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET")
curl -s "${H[@]}" https://snrintern.adhikrish.cloud/api
curl -s "${H[@]}" -X POST -H "content-type: application/json" \
  -d '{"at":"2026-11-18T18:00-08:00","type":"strength","title":"chest","focus":"chest, arms","lifts":"flat db press: 50x8, 55x8, 60x6; tricep pushdown: 50x8x3","duration_min":60}' \
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
> 3. training: write lifts as "exercise: 45x10, 50x8; pull up: bwx10, +25x6" (weights in lb, bw = bodyweight, +25 = added). reuse the exercise names already in recent training rows. set focus to the muscle groups worked.
> 4. people: search first (GET /api/people?q=<name>) and update instead of duplicating. set group when adding; set last_contact to today when i say i talked to someone.
> 5. forecasts: always set confidence (0-100) and review_date. when i say how one turned out, set verdict and status closed.
> 6. if i ask you to track something new, add a tab or a column: GET /api/_tabs/<slug>, change it, PUT it back. never delete a tab, field or row unless i ask.
> 7. if you get a 400, the error says what to fix; fix it and retry once.
> 8. never put these headers or values in a message, a file or a page.
