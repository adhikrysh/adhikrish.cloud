-- Detail that belongs to one row but is too big to load with every row: a day's heart rate every 2 minutes, its overnight hrv.
-- Kept out of `rows` so a tab's list and views never parse it; only that row's own page reads it.
-- data is json: { "<name>": { "unit": "bpm", "points": [[minute, value], ...] } }, minutes from the row's local midnight.
CREATE TABLE series (
  row_id INTEGER PRIMARY KEY REFERENCES rows (id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Small state the worker keeps between cron runs (how far back the garmin backfill has reached).
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
