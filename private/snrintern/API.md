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

`GET /api` returns every tab, its row count and its fields. tabs can be added at any time, so read this before writing anything, and never hard-code the list.

```json
{
  "tabs": [
    { "slug": "people", "label": "people", "rows": 24,
      "fields": [{ "name": "name", "type": "text", "required": true }, { "name": "email", "type": "text" }, ...] },
    ...
  ]
}
```

field types: `text` (any string) and `int` (a whole number, sent as a number or a numeric string). fields marked `required` must be present on create.

## endpoints

| method | path | body | returns |
|---|---|---|---|
| GET | `/api` | | tabs, counts, fields |
| GET | `/api/<tab>?q=<text>&limit=<n>` | | `{ "rows": [...] }`, newest first. `q` searches every text field (substring, case-insensitive for ascii). `limit` defaults to 100, max 1000. |
| GET | `/api/<tab>/<id>` | | `{ "row": {...} }` |
| POST | `/api/<tab>` | `{ "<field>": value, ... }` | `201 { "row": {...} }` |
| PATCH | `/api/<tab>/<id>` | only the fields to change | `{ "row": {...} }` |
| DELETE | `/api/<tab>/<id>` | | `{ "deleted": <id> }` |

every row also has `id`, `created_at`, `updated_at` (iso 8601 utc) and `updated_by` (who wrote it last: an email, or `service:<client-id>`). you can't set those.

## errors

errors come back as `{ "error": "<what to fix>" }`.

- `400` the body is wrong. the message names the field, e.g. `"rpe" must be a whole number` or `unknown field "weight". fields: date, type, ...`
- `401` not signed by cloudflare access
- `403` this token may only call /health
- `404` no such tab, row or id. a bad tab name lists the real ones.
- `405` wrong method for that path

## examples

```bash
H=(-H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET")
curl -s "${H[@]}" https://snrintern.adhikrish.cloud/api
curl -s "${H[@]}" "https://snrintern.adhikrish.cloud/api/people?q=example%20labs"
curl -s "${H[@]}" -X POST -H "content-type: application/json" \
  -d '{"date":"2026-11-18","type":"strength","title":"back day","duration_min":62,"rpe":7}' \
  https://snrintern.adhikrish.cloud/api/gym
curl -s "${H[@]}" -X PATCH -H "content-type: application/json" -d '{"replied":"yes","status":"replied"}' \
  https://snrintern.adhikrish.cloud/api/outbound/3
```

## instructions to give the agent

paste this into the dot's instructions, with the two values from 1password:

> you can read and write my snrintern database over https. base url https://snrintern.adhikrish.cloud. send headers CF-Access-Client-Id: <client-id> and CF-Access-Client-Secret: <client-secret> on every request.
> 1. start with GET /api. it lists the tabs and their fields. tabs change, so always read it first.
> 2. before adding a person or an outbound entry, search with GET /api/<tab>?q=<name> so you update the existing row (PATCH /api/<tab>/<id>) instead of creating a duplicate.
> 3. create with POST /api/<tab> and a json object of field: value. send only fields from GET /api. dates as yyyy-mm-dd, times as iso 8601.
> 4. if you get a 400, the error says which field to fix. fix it and retry once.
> 5. only delete when i ask you to.
> 6. never put these headers or values in a message, a file or a page.
