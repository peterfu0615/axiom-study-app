-- Rebuild the preferences table because SQLite cannot widen an existing
-- CHECK constraint in place. An untouched legacy 85% default becomes the new
-- balanced 70%; any row that was explicitly saved keeps its chosen value.
ALTER TABLE review_preferences RENAME TO review_preferences_v2;

CREATE TABLE review_preferences (
  id TEXT PRIMARY KEY NOT NULL CHECK (id='default'),
  max_daily_minutes INTEGER NOT NULL DEFAULT 25 CHECK (max_daily_minutes BETWEEN 5 AND 180),
  max_modules INTEGER NOT NULL DEFAULT 2 CHECK (max_modules BETWEEN 1 AND 12),
  preferred_mode TEXT NOT NULL DEFAULT 'standard'
    CHECK (preferred_mode IN ('quick', 'standard', 'mock_test')),
  target_retention REAL NOT NULL DEFAULT 0.70
    CHECK (target_retention BETWEEN 0.40 AND 0.90),
  target_retention_customized INTEGER NOT NULL DEFAULT 0
    CHECK (target_retention_customized IN (0,1)),
  variant_mode TEXT NOT NULL DEFAULT 'variant_preferred'
    CHECK (variant_mode IN ('variant_preferred', 'original_only')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO review_preferences(
  id,max_daily_minutes,max_modules,preferred_mode,target_retention,
  target_retention_customized,variant_mode,created_at,updated_at
)
SELECT id,max_daily_minutes,max_modules,preferred_mode,
  CASE
    WHEN ABS(target_retention - 0.85) < 0.000001 AND updated_at = created_at THEN 0.70
    ELSE MIN(0.90, MAX(0.40, target_retention))
  END,
  CASE WHEN ABS(target_retention - 0.85) < 0.000001 AND updated_at = created_at THEN 0 ELSE 1 END,
  variant_mode,created_at,updated_at
FROM review_preferences_v2;

DROP TABLE review_preferences_v2;

-- One immutable mistake capture per source problem. Re-analysis updates only
-- the controlled-tag revision while retaining the original error time.
CREATE TABLE problem_mistake_evidences (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL UNIQUE REFERENCES problems(id) ON DELETE CASCADE,
  captured_at INTEGER NOT NULL,
  tags_revision_hash TEXT NOT NULL,
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_problem_mistake_evidences_captured
  ON problem_mistake_evidences(captured_at, problem_id);

-- Persistent, resumable preparation jobs. Expensive generation and rendering
-- update these records after the preparation route has already painted.
CREATE TABLE practice_preparations (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('today','review_unit','skill')),
  source_ref TEXT NOT NULL,
  session_mode TEXT NOT NULL CHECK (session_mode IN ('quick','standard','mock_test')),
  status TEXT NOT NULL CHECK (status IN (
    'selecting','generating','verifying','rendering','ready','failed','cancelled'
  )),
  total_slots INTEGER NOT NULL CHECK (total_slots >= 0),
  practice_set_id TEXT REFERENCES practice_sets(id) ON DELETE SET NULL,
  safe_error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_practice_preparations_active_source
  ON practice_preparations(source_type,source_ref,session_mode)
  WHERE status IN ('selecting','generating','verifying','rendering');

CREATE INDEX idx_practice_preparations_resume
  ON practice_preparations(status,updated_at);

CREATE TABLE practice_preparation_slots (
  id TEXT PRIMARY KEY NOT NULL,
  preparation_id TEXT NOT NULL REFERENCES practice_preparations(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  source_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'selecting','generating','verifying','rendering','ready','failed'
  )),
  source_problem_id TEXT REFERENCES problems(id) ON DELETE SET NULL,
  variant_plan_id TEXT REFERENCES variant_plans(id) ON DELETE SET NULL,
  safe_error_code TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(preparation_id,order_index)
);

CREATE INDEX idx_practice_preparation_slots_status
  ON practice_preparation_slots(preparation_id,status,order_index);
