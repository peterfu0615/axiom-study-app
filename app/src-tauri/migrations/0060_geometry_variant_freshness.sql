-- Provenance makes generated geometry replace the source image only when it
-- was built from the current problem + completed solution revisions.
ALTER TABLE geometry_scenes ADD COLUMN input_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE geometry_scenes ADD COLUMN problem_revision_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE geometry_scenes ADD COLUMN solution_revision_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE diagrams ADD COLUMN source_model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL;
ALTER TABLE diagrams ADD COLUMN input_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE diagrams ADD COLUMN freshness_status TEXT NOT NULL DEFAULT 'fresh'
  CHECK (freshness_status IN ('fresh', 'stale'));

CREATE INDEX idx_diagrams_problem_freshness
  ON diagrams(owner_type, owner_id, freshness_status, updated_at DESC);

-- Variant-level and exposure fields are introduced with the same immutable
-- instance provenance migration; the Variants UI starts using them next.
ALTER TABLE variant_plans ADD COLUMN variation_level TEXT NOT NULL DEFAULT 'numeric'
  CHECK (variation_level IN ('numeric', 'condition', 'rebuild'));
ALTER TABLE variant_candidates ADD COLUMN instance_fingerprint TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_variant_candidates_fingerprint
  ON variant_candidates(instance_fingerprint) WHERE instance_fingerprint != '';

CREATE TABLE practice_instance_exposures (
  id TEXT PRIMARY KEY NOT NULL,
  practice_set_id TEXT NOT NULL REFERENCES practice_sets(id) ON DELETE CASCADE,
  practice_item_id TEXT NOT NULL REFERENCES practice_items(id) ON DELETE CASCADE,
  source_problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE RESTRICT,
  variant_candidate_id TEXT REFERENCES variant_candidates(id) ON DELETE RESTRICT,
  instance_fingerprint TEXT NOT NULL,
  exposed_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('preview', 'export', 'practice_open')),
  UNIQUE(practice_set_id, practice_item_id)
);

CREATE INDEX idx_practice_instance_exposures_freshness
  ON practice_instance_exposures(source_problem_id, exposed_at DESC);
