-- Persist deterministic pre-analysis textbook resolver decisions without
-- changing the established match source enum from migration 0023.

ALTER TABLE problems ADD COLUMN textbook_resolver_version TEXT;
ALTER TABLE problems ADD COLUMN textbook_candidate_count INTEGER NOT NULL DEFAULT 0
  CHECK (textbook_candidate_count >= 0);
ALTER TABLE problems ADD COLUMN textbook_decision_json TEXT;
