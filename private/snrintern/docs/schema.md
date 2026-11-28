# changing the schema

only when adhi asks to track something new. adding a tab or a column is one `PUT`, with no migration and no deploy, and every change lands in `GET /api/_log`.

- add a column: `GET /api/_tabs/<slug>`, append to `fields`, `PUT` the whole definition back (without `slug` and `position`). existing rows just lack it. removing a field hides it; values stay.
- a new tab: `PUT /api/_tabs/<slug>` with a definition; add `"after": "<slug>"` to place it on home after that tab. then tell adhi the repo needs `docs/<slug>.md` (its rules, served at `GET /api/_docs/<slug>`) and the tab named in `docs/core.md`; a test fails until both exist.
- `DELETE /api/_tabs/<slug>` only works on an empty tab, and only when he asks.

## a definition

```json
{
  "label": "<title>", "about": "<one line>",
  "title": "<field>", "aside": ["<field>"], "line": ["<field>"], "sort": "<field or id>", "snippet": "<text field>", "group": "<field>",
  "views": [{ "kind": "<view kind>", "...": "its keys" }],
  "fields": [
    { "name": "<snake_case>", "type": "<type>", "required": true },
    { "name": "<snake_case>", "type": "number", "min": 0, "max": 100, "unit": "<unit>" }
  ]
}
```

- `title`, `aside`, `line`: how a row reads in the list. `snippet`: a text field previewed under it. `sort`: `"id"` (newest first) or a field (largest first). `group`: a date field groups by day, a text or enum field by value.
- field types: `text`, `int` and `number` (`min`, `max`, `unit`), `date`, `datetime` (`time: true` requires the time), `url`, `enum` (`options`; `colors` gives a value an outlined pill: `"outline"`, `"good"` green, `"bad"` red), `ref` (`to`: a tab; `many: true` for a list), `lifts`.
- on a field: `required`, `hidden: true` (off the pages, still in the api), `section` (a heading on the row's page). on a tab: `hidden: true` (off home and the nav), `parts` (number fields drawn as one bar), `live` (`"weeks_left"` or `"felt_time_left"`: the description becomes a number worked out from his birthday).
- slugs: lowercase letters, digits, hyphens. fields: snake_case. `id`, `created_at`, `updated_at`, `updated_by` are reserved.
- never put in a target or threshold nobody gave you. a verdict comes from garmin's own labels, bands and goals, a clinical bound, or the number's own history.

## views

what a tab's page opens on, and what `GET /api/<tab>/_views` returns. `"page": false` keeps a view off the page (numbers for agents only). green is good, red is bad.

| kind | shows | keys |
|---|---|---|
| `progress` | each exercise's best set over time | `field` (lifts) |
| `strip` | a tick per day with a row; how many a week, the gap since the last | `field` (date), `label`, `days` |
| `line` | a number over time, zoomable; `tab` reads another tab | `field`, `tab` |
| `upcoming` | the next rows by a date, overdue in red, a bar for how near; `lead` before the title | `field`, `where`, `limit`, `lead` |
| `list` | rows matching `where` under a heading | `label`, `where`, `sort`, `aside` |
| `metrics` | each metric's day, one verdict from the closest source of truth (garmin's `label`, its `scale` bands, its `goal`, a slow `change`, else his own 28-day history), and 14 days of it | `label`, `metrics: [{ field, better, finished, change, stream, limit, per, goal, label, scale, log }]` |
| `load` | 7 days' total against his usual weeks; never a ratio | `field`, `label` |
| `limit` | the longest session in `days` (30) and the next one's limit, `over` (10) % past it (Frandsen et al., BJSM 2025) | `field`, `where`, `days`, `over`, `label` |
| `weeks` | per sport: time per week, zones over 28 days | `by`, `fields`, `zones`, `weeks`, `label` |
| `records` | each record's best recently against its best ever | `records: [{ label, field, best, where }]`, `days`, `label` |
| `graph` | rows and the rows their refs reach, as a graph | `label` |
| `cards` | a card per row whose enum `field` is in `show`, the first group outlined | `field`, `show`, `sub`, `foot`, `icon`, `label` |
| `calibration` | how many came true next to how sure he said | `confidence`, `verdict`, `right`, `min` |
