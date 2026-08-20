CREATE TABLE practice_grading_model_runs (
  id TEXT PRIMARY KEY NOT NULL,
  practice_response_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  safe_error_code TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (practice_response_id) REFERENCES practice_responses(id) ON DELETE CASCADE
);

CREATE INDEX idx_practice_grading_runs_response
  ON practice_grading_model_runs(practice_response_id, started_at DESC);

ALTER TABLE review_attempts ADD COLUMN overall_result TEXT NOT NULL DEFAULT 'incorrect'
  CHECK (overall_result IN ('correct', 'incorrect', 'partial'));
ALTER TABLE review_attempts ADD COLUMN process_complete INTEGER NOT NULL DEFAULT 0
  CHECK (process_complete IN (0, 1));
ALTER TABLE review_attempts ADD COLUMN error_reason TEXT;
ALTER TABLE review_attempts ADD COLUMN correct_alternative_step TEXT;
ALTER TABLE review_attempts ADD COLUMN used_target_method INTEGER
  CHECK (used_target_method IS NULL OR used_target_method IN (0, 1));
ALTER TABLE review_attempts ADD COLUMN applied_target_knowledge INTEGER
  CHECK (applied_target_knowledge IS NULL OR applied_target_knowledge IN (0, 1));
ALTER TABLE review_attempts ADD COLUMN matched_target_model INTEGER
  CHECK (matched_target_model IS NULL OR matched_target_model IN (0, 1));
ALTER TABLE review_attempts ADD COLUMN independent_completion INTEGER NOT NULL DEFAULT 1
  CHECK (independent_completion IN (0, 1));
ALTER TABLE review_attempts ADD COLUMN bundle_evidence_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(bundle_evidence_json));
ALTER TABLE review_attempts ADD COLUMN grading_model_run_id TEXT
  REFERENCES practice_grading_model_runs(id) ON DELETE SET NULL;
ALTER TABLE tag_evidences ADD COLUMN grading_model_run_id TEXT
  REFERENCES practice_grading_model_runs(id) ON DELETE SET NULL;

CREATE TRIGGER trg_practice_grading_run_terminal_update
BEFORE UPDATE ON practice_grading_model_runs
WHEN OLD.status IN ('succeeded', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'terminal practice grading model run is immutable');
END;

CREATE TRIGGER trg_practice_grading_run_terminal_delete
BEFORE DELETE ON practice_grading_model_runs
WHEN OLD.status IN ('succeeded', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'terminal practice grading model run is immutable');
END;

CREATE TRIGGER trg_review_attempt_grading_run_scope_insert
BEFORE INSERT ON review_attempts
WHEN NEW.grading_model_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM practice_grading_model_runs run
  JOIN practice_responses response ON response.id=run.practice_response_id
  JOIN practice_attempts attempt ON attempt.id=response.practice_attempt_id
  WHERE run.id=NEW.grading_model_run_id
    AND attempt.id IN (
      SELECT response_attempt.id FROM practice_attempts response_attempt
      JOIN practice_items item ON item.practice_set_id=response_attempt.practice_set_id
      JOIN question_instances instance ON instance.source_problem_id=item.source_problem_id
      WHERE instance.id=NEW.question_instance_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'practice grading model run does not match review attempt');
END;
