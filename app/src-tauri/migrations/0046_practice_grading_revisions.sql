-- Corrections are append-only. The original response, evidence and review log
-- remain immutable; readers use the latest revision as the effective result.
CREATE TABLE practice_grading_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  practice_attempt_id TEXT NOT NULL,
  practice_response_id TEXT NOT NULL,
  revision_index INTEGER NOT NULL CHECK (revision_index >= 1),
  revision_type TEXT NOT NULL CHECK (revision_type IN ('regrade', 'manual_override')),
  previous_grading_json TEXT NOT NULL CHECK (json_valid(previous_grading_json)),
  new_grading_json TEXT NOT NULL CHECK (json_valid(new_grading_json)),
  corrected_answer_json TEXT CHECK (corrected_answer_json IS NULL OR json_valid(corrected_answer_json)),
  operation_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (practice_attempt_id) REFERENCES practice_attempts(id) ON DELETE RESTRICT,
  FOREIGN KEY (practice_response_id) REFERENCES practice_responses(id) ON DELETE RESTRICT,
  UNIQUE (practice_response_id, revision_index),
  UNIQUE (practice_response_id, operation_key)
);

CREATE INDEX idx_practice_grading_revisions_latest
  ON practice_grading_revisions(practice_response_id, revision_index DESC, created_at DESC);

CREATE TRIGGER trg_practice_grading_revision_immutable_update
BEFORE UPDATE ON practice_grading_revisions
BEGIN
  SELECT RAISE(ABORT, 'practice grading revisions are append-only');
END;

CREATE TRIGGER trg_practice_grading_revision_immutable_delete
BEFORE DELETE ON practice_grading_revisions
BEGIN
  SELECT RAISE(ABORT, 'practice grading revisions are append-only');
END;

CREATE VIEW practice_effective_responses AS
SELECT response.id AS response_id,
  response.practice_attempt_id,
  response.practice_item_id,
  response.extracted_answer_json,
  response.corrected_answer_json,
  response.grading_result_json,
  response.status,
  latest.id AS latest_revision_id,
  latest.revision_index AS latest_revision_index,
  COALESCE(latest.corrected_answer_json, response.corrected_answer_json, response.extracted_answer_json) AS effective_answer_json,
  COALESCE(latest.new_grading_json, response.grading_result_json) AS effective_grading_json
FROM practice_responses response
LEFT JOIN practice_grading_revisions latest
  ON latest.practice_response_id = response.id
 AND NOT EXISTS (
   SELECT 1 FROM practice_grading_revisions newer
   WHERE newer.practice_response_id = latest.practice_response_id
     AND newer.revision_index > latest.revision_index
 );

ALTER TABLE practice_loop_rounds ADD COLUMN superseded_at INTEGER;
CREATE INDEX idx_practice_loop_rounds_active
  ON practice_loop_rounds(practice_loop_id, status, superseded_at, round_index DESC);
