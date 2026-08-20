-- Separate the daily scheduling container from concrete practice sessions.
-- Every generated PracticeSet receives its own auditable ReviewSession.
DROP INDEX IF EXISTS idx_today_one_standard_session;

ALTER TABLE review_sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'today'
  CHECK (session_kind IN ('today', 'practice'));
ALTER TABLE review_sessions ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(settings_json));
ALTER TABLE review_sessions ADD COLUMN updated_at INTEGER;
ALTER TABLE review_sessions ADD COLUMN submitted_at INTEGER;
ALTER TABLE review_sessions ADD COLUMN applied_at INTEGER;
ALTER TABLE review_sessions ADD COLUMN failure_code TEXT;

UPDATE review_sessions SET updated_at = COALESCE(completed_at, created_at) WHERE updated_at IS NULL;

CREATE UNIQUE INDEX idx_today_one_session
  ON review_sessions(session_date)
  WHERE session_kind = 'today';
CREATE INDEX idx_review_sessions_kind_status
  ON review_sessions(session_kind, status, created_at DESC);

ALTER TABLE practice_sets ADD COLUMN review_session_id TEXT REFERENCES review_sessions(id) ON DELETE RESTRICT;
ALTER TABLE practice_sets ADD COLUMN session_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (session_mode IN ('quick', 'standard', 'mock_test'));
ALTER TABLE practice_sets ADD COLUMN session_settings_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(session_settings_json));

UPDATE practice_sets
SET review_session_id = source_ref
WHERE source_type = 'today'
  AND EXISTS (SELECT 1 FROM review_sessions session WHERE session.id = practice_sets.source_ref);

UPDATE practice_sets
SET review_session_id = (
  SELECT module.session_id FROM review_modules module
  WHERE module.id = practice_sets.source_ref
)
WHERE source_type = 'review_unit'
  AND EXISTS (SELECT 1 FROM review_modules module WHERE module.id = practice_sets.source_ref);

CREATE INDEX idx_practice_sets_review_session
  ON practice_sets(review_session_id) WHERE review_session_id IS NOT NULL;

CREATE TABLE review_session_events (
  id TEXT PRIMARY KEY NOT NULL,
  review_session_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  safe_code TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE RESTRICT
);

CREATE INDEX idx_review_session_events_session
  ON review_session_events(review_session_id, created_at, id);

INSERT INTO review_session_events(id, review_session_id, from_status, to_status, safe_code, metadata_json, created_at)
SELECT 'legacy:' || id, id, NULL, status, 'legacy_backfill', '{}', created_at
FROM review_sessions;

CREATE TRIGGER prevent_review_session_event_update
BEFORE UPDATE ON review_session_events
BEGIN
  SELECT RAISE(ABORT, 'review session event is immutable');
END;

CREATE TRIGGER prevent_review_session_event_delete
BEFORE DELETE ON review_session_events
BEGIN
  SELECT RAISE(ABORT, 'review session event is immutable');
END;
