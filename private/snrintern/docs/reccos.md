# reccos

recommendations of any kind: one row per thing, for its whole life.

- a new one: `title`, `kind` (book, movie, show, podcast, article), `creator` (author, director, host), `status: next`, `recommended_by` (who or where it came from).
- starting, finishing or dropping it is a PATCH of `status` (on it, finished, dropped) on the same row.
- search first (`GET /api/reccos?q=<title>`) so nothing is added twice.
- no dates and no notes: his thoughts on it go in his second brain.
