-- One row per probe of one service, every 5 minutes, kept 30 days. Feeds the uptime strips on the page.
CREATE TABLE probes (
  service TEXT NOT NULL,
  at INTEGER NOT NULL,  -- unix ms
  up INTEGER NOT NULL   -- 1 or 0
);
CREATE INDEX probes_service_at ON probes (service, at);
