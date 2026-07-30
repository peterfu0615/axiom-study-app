CREATE TABLE IF NOT EXISTS problem_regions (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  region_type TEXT NOT NULL CHECK (region_type IN (
    'question', 'answer', 'diagram', 'annotation'
  )),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  image_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problem_regions_problem_type
  ON problem_regions(problem_id, region_type, updated_at);

CREATE TABLE IF NOT EXISTS student_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  answer_region_ids_json TEXT NOT NULL DEFAULT '[]',
  raw_markdown TEXT NOT NULL DEFAULT '',
  steps_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'pending', 'processing', 'completed', 'failed'
  )),
  active_model_run_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(problem_id)
);

CREATE TABLE IF NOT EXISTS reasoning_analyses (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  student_attempt_id TEXT NOT NULL REFERENCES student_attempts(id) ON DELETE CASCADE,
  solution_id TEXT REFERENCES problem_solutions(id) ON DELETE SET NULL,
  approach TEXT,
  step_evaluations_json TEXT NOT NULL DEFAULT '[]',
  first_wrong_step INTEGER,
  error_type TEXT,
  reason TEXT,
  knowledge_gaps_json TEXT NOT NULL DEFAULT '[]',
  suggestion TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'pending', 'processing', 'completed', 'failed'
  )),
  active_model_run_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(student_attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_reasoning_analyses_problem
  ON reasoning_analyses(problem_id, updated_at);

INSERT OR IGNORE INTO problem_regions (
  id, problem_id, region_type, x, y, width, height, image_path, created_at, updated_at
)
SELECT
  'legacy-question-' || p.id,
  p.id,
  'question',
  p.crop_x,
  p.crop_y,
  p.crop_width,
  p.crop_height,
  p.crop_image_path,
  p.created_at,
  p.updated_at
FROM problems p
WHERE p.crop_image_path IS NOT NULL;
