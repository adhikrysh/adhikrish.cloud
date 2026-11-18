-- From here on the schema is data: tabs and their fields live in `tabs`, rows are json documents in `rows`.
-- Adding a tab or a column is an api call (PUT /api/_tabs/<slug>), not a migration.
-- The four typed tables from 0001 were never filled, so they are dropped.
DROP TABLE people;
DROP TABLE outbound;
DROP TABLE forecasts;
DROP TABLE gym;

CREATE TABLE tabs (
  slug TEXT PRIMARY KEY,          -- url segment: lowercase letters, digits, hyphens
  position INTEGER NOT NULL,      -- order on the home page
  definition TEXT NOT NULL,       -- json: label, about, title, aside, line, sort, fields (see src/schema.ts)
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE rows (
  id INTEGER PRIMARY KEY,
  tab TEXT NOT NULL REFERENCES tabs (slug),
  data TEXT NOT NULL,             -- json object: field name -> value
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX rows_tab ON rows (tab, id DESC);

-- Every schema change: who, when, and the definition before and after (null before = created, null after = deleted).
CREATE TABLE schema_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  tab TEXT NOT NULL,
  before TEXT,
  after TEXT
);

INSERT INTO tabs (slug, position, definition, updated_at, updated_by) VALUES
('people', 1, '{"label":"people","about":"people i''ve met, and where","title":"name","aside":["met_date"],"line":["company","title","met_where"],"sort":"id","fields":[{"name":"name","type":"text","required":true},{"name":"email","type":"text"},{"name":"company","type":"text"},{"name":"title","type":"text"},{"name":"met_where","type":"text"},{"name":"met_date","type":"date"},{"name":"location","type":"text"},{"name":"linkedin","type":"url"},{"name":"twitter","type":"url"},{"name":"referred_by","type":"text"},{"name":"notes","type":"text"}]}', '2026-11-18T00:00:00Z', 'migration:0002'),
('outbound', 2, '{"label":"outbound","about":"cold outreach and who replied","title":"name","aside":["reply"],"line":["platform","reason"],"sort":"id","fields":[{"name":"name","type":"text","required":true},{"name":"context","type":"text"},{"name":"platform","type":"text"},{"name":"reason","type":"text"},{"name":"message","type":"text"},{"name":"reply","type":"enum","options":["no reply","replied"]},{"name":"follow_ups","type":"text"},{"name":"remarks","type":"text"},{"name":"email","type":"text"}]}', '2026-11-18T00:00:00Z', 'migration:0002'),
('forecasts', 3, '{"label":"forecasts","about":"predictions to be scored later","title":"decision","aside":["confidence","status"],"line":["review_date","verdict"],"sort":"date","fields":[{"name":"date","type":"date"},{"name":"decision","type":"text","required":true},{"name":"rationale","type":"text"},{"name":"confidence","type":"int","min":0,"max":100},{"name":"expected","type":"text"},{"name":"review_date","type":"date"},{"name":"outcome","type":"text"},{"name":"verdict","type":"enum","options":["right","wrong"]},{"name":"status","type":"enum","options":["open","closed"]}]}', '2026-11-18T00:00:00Z', 'migration:0002'),
('gym', 4, '{"label":"gym","about":"training sessions","title":"title","aside":["at"],"line":["type","duration_min","rpe"],"sort":"at","fields":[{"name":"at","type":"datetime","required":true},{"name":"type","type":"enum","options":["strength","cardio","other"]},{"name":"title","type":"text"},{"name":"summary","type":"text"},{"name":"duration_min","type":"int","min":0},{"name":"rpe","type":"int","min":1,"max":10},{"name":"notes","type":"text"}]}', '2026-11-18T00:00:00Z', 'migration:0002');
