-- d1 applies migrations in order (npx cf d1 migrations apply snrintern). Never edit an applied one.
-- The four tabs imported from the "snr intern" google sheet on 2026-11-17.
-- Every table: id, created_at, updated_at (iso utc), updated_by (who wrote it: an email or a service token name).

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, email TEXT, company TEXT, title TEXT, met_where TEXT, met_date TEXT,
  location TEXT, linkedin TEXT, twitter TEXT, referred_by TEXT, notes TEXT, added_date TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);

CREATE TABLE outbound (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, person_context TEXT, platform TEXT, reason TEXT, message TEXT, replied TEXT,
  follow_up TEXT, remarks TEXT, email TEXT, sent_date TEXT, status TEXT, last_comment TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);

CREATE TABLE forecasts (
  id INTEGER PRIMARY KEY,
  date TEXT, decision TEXT NOT NULL, rationale TEXT, confidence TEXT, expected TEXT,
  review_date TEXT, outcome TEXT, verdict TEXT, status TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);

CREATE TABLE gym (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL, type TEXT, title TEXT, summary TEXT, duration_min INTEGER, rpe INTEGER, feel TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
