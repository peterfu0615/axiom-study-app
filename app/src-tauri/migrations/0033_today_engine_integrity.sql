-- Axiom 0.5.0 Today Engine integrity and idempotency guards.
--
-- Migration 0001 already owns the legacy, problem-level `review_logs` table,
-- so migration 0027's CREATE TABLE IF NOT EXISTS could not install the
-- Horizon bundle log shape. Keep that history intact and append the correct
-- immutable bundle log under an unambiguous name.

CREATE TABLE IF NOT EXISTS horizon_review_logs (
  id TEXT PRIMARY KEY NOT NULL,
  review_attempt_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  skill_bundle_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  previous_state_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  new_state_json TEXT NOT NULL,
  scheduler_version TEXT NOT NULL DEFAULT 'horizon-v1',
  reviewed_at INTEGER NOT NULL,
  FOREIGN KEY (review_attempt_id) REFERENCES review_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_bundle_id) REFERENCES skill_bundles(id) ON DELETE CASCADE,
  UNIQUE (review_attempt_id)
);

ALTER TABLE review_attempts ADD COLUMN rating TEXT
  CHECK (rating IS NULL OR rating IN ('again', 'hard', 'good', 'easy'));
ALTER TABLE review_attempts ADD COLUMN result_key TEXT;
ALTER TABLE review_modules ADD COLUMN completed_at INTEGER;

-- A private build may already have exercised migration 0027. Preserve every
-- session but keep only the earliest standard identity for each date; older
-- duplicates remain readable as legacy sessions instead of blocking upgrade.
UPDATE review_sessions
SET mode = 'legacy'
WHERE mode = 'standard'
  AND EXISTS (
    SELECT 1 FROM review_sessions keeper
    WHERE keeper.mode = 'standard'
      AND keeper.session_date = review_sessions.session_date
      AND (keeper.created_at < review_sessions.created_at OR (
        keeper.created_at = review_sessions.created_at AND keeper.id < review_sessions.id
      ))
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_today_one_standard_session
  ON review_sessions(session_date)
  WHERE mode = 'standard';
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_attempt_result_key
  ON review_attempts(result_key)
  WHERE result_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_review_sessions_date_status
  ON review_sessions(session_date, status);
CREATE INDEX IF NOT EXISTS idx_review_modules_session_status
  ON review_modules(session_id, status, order_index);
CREATE INDEX IF NOT EXISTS idx_question_instances_source_problem
  ON question_instances(source_problem_id);
CREATE INDEX IF NOT EXISTS idx_review_attempts_question_created
  ON review_attempts(question_instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_horizon_review_logs_bundle_time
  ON horizon_review_logs(subject, skill_bundle_id, reviewed_at DESC);
