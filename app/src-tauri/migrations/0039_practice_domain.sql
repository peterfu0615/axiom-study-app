-- PracticeSet is the durable source of truth. Preview, PDF and attempts are
-- representations or evidence derived from this immutable item snapshot.
CREATE TABLE practice_sets (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('review_unit', 'skill', 'today', 'practice_attempt')),
  source_ref TEXT NOT NULL,
  strategy TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('draft', 'ready', 'archived')),
  target_skills_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(target_skills_json)),
  generation_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(generation_metadata_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_practice_sets_source
  ON practice_sets(source_type, source_ref, created_at DESC);

CREATE TABLE practice_items (
  id TEXT PRIMARY KEY NOT NULL,
  practice_set_id TEXT NOT NULL,
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('existing_problem', 'generated_variant')),
  source_problem_id TEXT,
  subject TEXT NOT NULL,
  target_skill_bundle_id TEXT,
  target_tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(target_tags_json)),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('basic', 'intermediate', 'advanced')),
  statement_markdown TEXT NOT NULL CHECK (length(trim(statement_markdown)) > 0),
  options_json TEXT CHECK (options_json IS NULL OR json_valid(options_json)),
  canonical_answer TEXT NOT NULL CHECK (length(trim(canonical_answer)) > 0),
  solution_json TEXT NOT NULL CHECK (json_valid(solution_json)),
  grading_rubric_json TEXT NOT NULL CHECK (json_valid(grading_rubric_json)),
  generation_metadata_json TEXT CHECK (generation_metadata_json IS NULL OR json_valid(generation_metadata_json)),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (practice_set_id) REFERENCES practice_sets(id) ON DELETE CASCADE,
  FOREIGN KEY (source_problem_id) REFERENCES problems(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_skill_bundle_id) REFERENCES skill_bundles(id) ON DELETE SET NULL,
  UNIQUE (practice_set_id, order_index),
  CHECK (
    (source_type = 'existing_problem' AND source_problem_id IS NOT NULL) OR
    (source_type = 'generated_variant' AND generation_metadata_json IS NOT NULL)
  )
);

CREATE INDEX idx_practice_items_set
  ON practice_items(practice_set_id, order_index);
CREATE INDEX idx_practice_items_source_problem
  ON practice_items(source_problem_id) WHERE source_problem_id IS NOT NULL;
