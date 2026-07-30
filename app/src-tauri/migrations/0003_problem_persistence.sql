ALTER TABLE problems ADD COLUMN title TEXT;
ALTER TABLE problems ADD COLUMN status TEXT NOT NULL DEFAULT 'candidate'
  CHECK (status IN ('candidate', 'saved'));
ALTER TABLE problems ADD COLUMN archived_at INTEGER;
ALTER TABLE problems ADD COLUMN deleted_at INTEGER;

UPDATE problems
SET title = stem_markdown
WHERE title IS NULL;

CREATE INDEX IF NOT EXISTS idx_problems_library
  ON problems(status, deleted_at, archived_at, created_at DESC);
