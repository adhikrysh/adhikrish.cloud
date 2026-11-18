# snrintern api

base url: `https://snrintern.adhikrish.cloud`

## auth

send both headers on every request. the values are in 1password: `Personal › snrintern dots token`.

```
CF-Access-Client-Id: <client-id>
CF-Access-Client-Secret: <client-secret>
```

cloudflare access checks them before the request reaches snrintern. without them you get a 302 to a login page. a valid token that isn't on snrintern's agent list gets `403`.

## discover first

`GET /api` returns every tab with its definition and row count. tabs and columns change at any time, so read this before writing anything, and never hard-code the list.

```json
{
  "tabs": [
    { "slug": "gym", "position": 4, "rows": 16, "label": "gym", "about": "training sessions",
      "title": "title", "aside": ["at"], "line": ["type", "duration_min", "rpe"], "sort": "at",
      "fields": [{ "name": "at", "type": "datetime", "required": true }, { "name": "rpe", "type": "int", "min": 1, "max": 10 }, ...] },
    ...
  ]
}
```

field types:

| type | accepts | example |
|---|---|---|
| `text` | any string | `"met at the demo night"` |
| `int` | a whole number (or numeric string), within `min`/`max` if set | `62` |
| `date` | `yyyy-mm-dd` | `"2026-11-18"` |
| `datetime` | a date, or an iso date-time with optional offset | `"2026-11-18T09:30-08:00"` |
| `url` | starts with `http://` or `https://` | `"https://x.com/someone"` |
| `enum` | exactly one of the field's `options` | `"replied"` |

fields marked `required` must be present on create. send `null` or `""` in a PATCH to clear a field.

## endpoints

| method | path | body | returns |
|---|---|---|---|
| GET | `/api` | | tabs, counts, fields |
| GET | `/api/<tab>?q=<text>&limit=<n>` | | `{ "rows": [...] }`, newest first. `q` searches every text field (substring, case-insensitive for ascii). `limit` defaults to 100, max 1000. |
| GET | `/api/<tab>/<id>` | | `{ "row": {...} }` |
| POST | `/api/<tab>` | `{ "<field>": value, ... }` | `201 { "row": {...} }` |
| PATCH | `/api/<tab>/<id>` | only the fields to change | `{ "row": {...} }` |
| DELETE | `/api/<tab>/<id>` | | `{ "deleted": <id> }` |
| GET | `/api/_tabs/<slug>` | | `{ "tab": {...} }`, one definition |
| PUT | `/api/_tabs/<slug>` | a full definition (below) | `201` created or `200` replaced, `{ "tab": {...} }` |
| DELETE | `/api/_tabs/<slug>` | | `{ "deleted": "<slug>" }`; `409` while the tab has rows |
| GET | `/api/_log?limit=<n>` | | `{ "changes": [{ at, by, tab, before, after }] }`, newest first |

## changing the schema

the schema is data: adding a tab or a column is a `PUT`, with no migration and no deploy. to add a column, `GET /api/_tabs/<slug>`, append to `fields`, and `PUT` the whole definition back (drop `slug` and `position`). existing rows simply don't have the new field until someone sets it. removing a field hides it; values already stored stay in the rows. every change is logged with who made it (`GET /api/_log`).

a definition:

```json
{
  "label": "thoughts",
  "about": "things worth remembering",
  "title": "text",
  "aside": ["at"],
  "line": ["source"],
  "sort": "at",
  "fields": [
    { "name": "text", "type": "text", "required": true },
    { "name": "at", "type": "datetime" },
    { "name": "source", "type": "url" },
    { "name": "mood", "type": "enum", "options": ["good", "meh", "bad"] }
  ]
}
```

slugs: lowercase letters, digits, hyphens. field names: lowercase snake_case. `id`, `created_at`, `updated_at` and `updated_by` are reserved. `title`, `aside`, `line` decide how a row reads in the list; `sort` is `"id"` (newest first) or a field name (largest first, empty last).

every row also has `id`, `created_at`, `updated_at` (iso 8601 utc) and `updated_by` (who wrote it last: an email, or `service:<client-id>`). you can't set those.

## errors

errors come back as `{ "error": "<what to fix>" }`.

- `400` the body is wrong. the message names the field, e.g. `"rpe" must be a whole number` or `unknown field "weight". fields: date, type, ...`
- `401` not signed by cloudflare access
- `403` this token may only call /health
- `404` no such tab, row or id. a bad tab name lists the real ones.
- `409` deleting a tab that still has rows
- `405` wrong method for that path

## examples

```bash
H=(-H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET")
curl -s "${H[@]}" https://snrintern.adhikrish.cloud/api
curl -s "${H[@]}" "https://snrintern.adhikrish.cloud/api/people?q=example%20labs"
curl -s "${H[@]}" -X POST -H "content-type: application/json" \
  -d '{"at":"2026-11-18T18:00-08:00","type":"strength","title":"back day","duration_min":62,"rpe":7}' \
  https://snrintern.adhikrish.cloud/api/gym
curl -s "${H[@]}" -X PATCH -H "content-type: application/json" -d '{"reply":"replied"}' \
  https://snrintern.adhikrish.cloud/api/outbound/3
```

## instructions to give the agent

paste this into the dot's instructions, with the two values from 1password:

> you can read and write my snrintern database over https. base url https://snrintern.adhikrish.cloud. send headers CF-Access-Client-Id: <client-id> and CF-Access-Client-Secret: <client-secret> on every request.
> 1. start with GET /api. it lists the tabs and their fields. tabs change, so always read it first.
> 2. before adding a person or an outbound entry, search with GET /api/<tab>?q=<name> so you update the existing row (PATCH /api/<tab>/<id>) instead of creating a duplicate.
> 3. create with POST /api/<tab> and a json object of field: value. send only fields from GET /api. dates as yyyy-mm-dd, times as iso 8601.
> 4. if you get a 400, the error says which field to fix. fix it and retry once.
> 5. if i ask you to track something new, add a tab or a column: GET /api/_tabs/<slug>, change it, PUT it back. never delete a tab or a field unless i ask.
> 6. only delete rows when i ask you to.
> 7. never put these headers or values in a message, a file or a page.
