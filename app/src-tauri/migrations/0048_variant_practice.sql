-- Durable 0.6 Variant Practice audit trail. A generated practice item is only
-- selectable after a separate verification run satisfies the invariant checks.
CREATE TABLE variant_plans (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  source_problem_id TEXT NOT NULL,
  skill_bundle_id TEXT,
  target_tags_json TEXT NOT NULL CHECK (json_valid(target_tags_json)),
  target_difficulty TEXT NOT NULL CHECK (target_difficulty IN ('basic', 'intermediate', 'advanced')),
  invariants_json TEXT NOT NULL CHECK (json_valid(invariants_json)),
  allowed_changes_json TEXT NOT NULL CHECK (json_valid(allowed_changes_json)),
  forbidden_changes_json TEXT NOT NULL CHECK (json_valid(forbidden_changes_json)),
  source_input_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'generating', 'verified', 'rejected', 'failed', 'superseded')),
  selected_candidate_id TEXT,
  failure_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_problem_id) REFERENCES problems(id) ON DELETE RESTRICT,
  FOREIGN KEY (skill_bundle_id) REFERENCES skill_bundles(id) ON DELETE SET NULL
);

CREATE INDEX idx_variant_plans_source
  ON variant_plans(source_problem_id, created_at DESC);
CREATE INDEX idx_variant_plans_bundle
  ON variant_plans(skill_bundle_id, created_at DESC) WHERE skill_bundle_id IS NOT NULL;

CREATE TABLE variant_model_runs (
  id TEXT PRIMARY KEY NOT NULL,
  variant_plan_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('generation', 'verification')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  raw_output TEXT NOT NULL DEFAULT '',
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  safe_error_code TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY (variant_plan_id) REFERENCES variant_plans(id) ON DELETE RESTRICT
);

CREATE INDEX idx_variant_model_runs_plan
  ON variant_model_runs(variant_plan_id, stage, created_at);

CREATE TABLE variant_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  variant_plan_id TEXT NOT NULL,
  generation_model_run_id TEXT NOT NULL,
  verification_model_run_id TEXT,
  candidate_json TEXT NOT NULL CHECK (json_valid(candidate_json)),
  verification_json TEXT CHECK (verification_json IS NULL OR json_valid(verification_json)),
  validation_errors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(validation_errors_json)),
  status TEXT NOT NULL CHECK (status IN ('generated', 'verified', 'rejected')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (variant_plan_id) REFERENCES variant_plans(id) ON DELETE RESTRICT,
  FOREIGN KEY (generation_model_run_id) REFERENCES variant_model_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (verification_model_run_id) REFERENCES variant_model_runs(id) ON DELETE RESTRICT
);

CREATE INDEX idx_variant_candidates_plan
  ON variant_candidates(variant_plan_id, created_at);

ALTER TABLE practice_items ADD COLUMN variant_plan_id TEXT REFERENCES variant_plans(id) ON DELETE RESTRICT;
CREATE INDEX idx_practice_items_variant_plan
  ON practice_items(variant_plan_id) WHERE variant_plan_id IS NOT NULL;

CREATE TRIGGER validate_practice_item_variant_plan_insert
BEFORE INSERT ON practice_items
WHEN
  (NEW.source_type = 'existing_problem' AND NEW.variant_plan_id IS NOT NULL)
  OR
  (NEW.source_type = 'generated_variant' AND NOT EXISTS (
    SELECT 1 FROM variant_plans plan
    WHERE plan.id = NEW.variant_plan_id
      AND plan.status = 'verified'
      AND plan.source_problem_id = NEW.source_problem_id
      AND plan.subject = NEW.subject
  ))
BEGIN
  SELECT RAISE(ABORT, 'practice item variant plan is missing or unverified');
END;

CREATE TRIGGER validate_practice_item_variant_plan_update
BEFORE UPDATE OF source_type, source_problem_id, variant_plan_id, subject ON practice_items
WHEN
  (NEW.source_type = 'existing_problem' AND NEW.variant_plan_id IS NOT NULL)
  OR
  (NEW.source_type = 'generated_variant' AND NOT EXISTS (
    SELECT 1 FROM variant_plans plan
    WHERE plan.id = NEW.variant_plan_id
      AND plan.status = 'verified'
      AND plan.source_problem_id = NEW.source_problem_id
      AND plan.subject = NEW.subject
  ))
BEGIN
  SELECT RAISE(ABORT, 'practice item variant plan is missing or unverified');
END;

CREATE TRIGGER prevent_verified_variant_plan_update
BEFORE UPDATE ON variant_plans
WHEN OLD.status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified variant plan is immutable');
END;

CREATE TRIGGER prevent_verified_variant_plan_delete
BEFORE DELETE ON variant_plans
WHEN OLD.status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified variant plan is immutable');
END;

CREATE TRIGGER prevent_verified_variant_candidate_update
BEFORE UPDATE ON variant_candidates
WHEN OLD.status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified variant candidate is immutable');
END;

CREATE TRIGGER prevent_verified_variant_candidate_delete
BEFORE DELETE ON variant_candidates
WHEN OLD.status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified variant candidate is immutable');
END;
