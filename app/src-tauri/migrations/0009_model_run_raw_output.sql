ALTER TABLE model_runs ADD COLUMN raw_output TEXT NOT NULL DEFAULT '';
ALTER TABLE model_runs ADD COLUMN repair_strategy TEXT;
