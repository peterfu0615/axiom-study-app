CREATE TABLE geometry_scenes (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  model_run_id TEXT NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  source_image_path TEXT NOT NULL,
  scene_json TEXT NOT NULL CHECK (json_valid(scene_json)),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('validated', 'rejected')),
  validation_errors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(validation_errors_json)),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(model_run_id)
);

CREATE INDEX idx_geometry_scenes_problem
  ON geometry_scenes(problem_id, created_at DESC);
