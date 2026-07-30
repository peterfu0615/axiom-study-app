CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY NOT NULL,
  original_image_path TEXT NOT NULL,
  corrected_image_path TEXT,
  content_hash TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('camera', 'import', 'clipboard')),
  processing_status TEXT NOT NULL DEFAULT 'captured',
  captured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_documents_hash
  ON source_documents(content_hash);

CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  crop_x REAL NOT NULL DEFAULT 0,
  crop_y REAL NOT NULL DEFAULT 0,
  crop_width REAL NOT NULL DEFAULT 1,
  crop_height REAL NOT NULL DEFAULT 1,
  crop_image_path TEXT,
  subject TEXT,
  problem_type TEXT,
  stem_markdown TEXT,
  structured_content_json TEXT,
  solution_json TEXT,
  model_confidence REAL,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problems_source
  ON problems(source_document_id);

CREATE TABLE IF NOT EXISTS user_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  answer_text TEXT,
  answer_image_path TEXT,
  is_correct INTEGER,
  first_error_step TEXT,
  error_category TEXT,
  duration_seconds INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id TEXT PRIMARY KEY NOT NULL,
  canonical_name TEXT NOT NULL,
  parent_id TEXT REFERENCES knowledge_points(id),
  subject TEXT NOT NULL,
  curriculum_version TEXT,
  UNIQUE(canonical_name, subject, curriculum_version)
);

CREATE TABLE IF NOT EXISTS problem_knowledge_points (
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  confidence REAL,
  source TEXT NOT NULL CHECK (source IN ('model', 'user')),
  PRIMARY KEY(problem_id, knowledge_point_id)
);

CREATE TABLE IF NOT EXISTS review_states (
  problem_id TEXT PRIMARY KEY NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  difficulty REAL NOT NULL,
  stability REAL NOT NULL,
  retrievability REAL NOT NULL,
  desired_retention REAL NOT NULL DEFAULT 0.9,
  last_review_at INTEGER,
  next_review_at INTEGER,
  review_count INTEGER NOT NULL DEFAULT 0,
  lapse_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS review_logs (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  scheduled_days REAL NOT NULL,
  elapsed_days REAL NOT NULL,
  duration_seconds INTEGER,
  reviewed_at INTEGER NOT NULL,
  scheduler_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_due
  ON review_states(next_review_at);

CREATE TABLE IF NOT EXISTS model_runs (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_json TEXT,
  latency_ms INTEGER,
  token_usage INTEGER,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
