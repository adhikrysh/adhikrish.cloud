-- The page now shows the last stored probe instead of probing on every visit, so each probe keeps
-- what the page displays: the http status, the response time and the error.
ALTER TABLE probes ADD COLUMN status INTEGER;
ALTER TABLE probes ADD COLUMN ms INTEGER;
ALTER TABLE probes ADD COLUMN error TEXT;
