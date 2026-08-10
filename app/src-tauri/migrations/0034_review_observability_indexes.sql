-- Phase 2 reads immutable review evidence in one ordered pass for replay and
-- historical insights. These indexes avoid scanning every evidence row as
-- review history grows; no new analytics source of truth is introduced.

CREATE INDEX IF NOT EXISTS idx_tag_evidences_attempt_tag
  ON tag_evidences(review_attempt_id, tag_id, created_at);

CREATE INDEX IF NOT EXISTS idx_review_attempts_created_rating
  ON review_attempts(created_at DESC, rating);

CREATE INDEX IF NOT EXISTS idx_review_modules_completed_status
  ON review_modules(completed_at DESC, status, session_id);
