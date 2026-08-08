-- Structured AI failures and auditable provider attempts.
-- Keep model_runs.error_message and provider_attempts_json for historical
-- readers; new code writes both the compatibility fields and this schema.

ALTER TABLE model_runs ADD COLUMN error_code TEXT;
ALTER TABLE model_runs ADD COLUMN error_json TEXT;

CREATE TABLE IF NOT EXISTS provider_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  model_run_id TEXT NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  attempt_index INTEGER NOT NULL CHECK (attempt_index > 0),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'cancelled')),
  error_code TEXT,
  error_json TEXT,
  raw_output_excerpt TEXT NOT NULL DEFAULT '',
  repair_strategy TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  UNIQUE(model_run_id, attempt_index)
);

CREATE INDEX IF NOT EXISTS idx_provider_attempts_run
  ON provider_attempts(model_run_id, attempt_index);
