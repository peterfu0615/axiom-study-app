-- Closeout integrity for subject lifecycle and user/AI region precedence.

ALTER TABLE problem_regions ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'
  CHECK (source IN ('manual', 'auto'));

UPDATE problem_regions
SET source = 'manual'
WHERE id NOT LIKE 'ai-diagram-%';

CREATE INDEX IF NOT EXISTS idx_problem_regions_preferred
  ON problem_regions(problem_id, region_type, source, updated_at DESC);

CREATE TABLE IF NOT EXISTS subjects (
  name TEXT PRIMARY KEY NOT NULL CHECK (length(trim(name)) > 0),
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO subjects(name, archived_at, created_at, updated_at)
SELECT subject, NULL, MIN(created_at), MAX(updated_at)
FROM (
  SELECT trim(subject) AS subject, created_at, updated_at FROM textbooks
  UNION ALL
  SELECT trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))), created_at, updated_at FROM problems
  UNION ALL
  SELECT trim(subject), created_at, updated_at FROM tag_definitions
  UNION ALL
  SELECT trim(module.subject), session.created_at, session.created_at
  FROM review_modules module JOIN review_sessions session ON session.id = module.session_id
)
WHERE subject <> ''
GROUP BY subject;

CREATE INDEX IF NOT EXISTS idx_subjects_active ON subjects(archived_at, name);
