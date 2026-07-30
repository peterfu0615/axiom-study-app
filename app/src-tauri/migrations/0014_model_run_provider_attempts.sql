ALTER TABLE model_runs
  ADD COLUMN provider_attempts_json TEXT NOT NULL DEFAULT '[]';

