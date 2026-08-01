-- Store an independent textbook route for each problem.  This is additive so
-- existing problems remain readable and the legacy is_current column remains
-- available only for compatibility.
ALTER TABLE problems ADD COLUMN matched_textbook_id TEXT;
ALTER TABLE problems ADD COLUMN textbook_match_confidence REAL NOT NULL DEFAULT 0
  CHECK (textbook_match_confidence BETWEEN 0 AND 1);
ALTER TABLE problems ADD COLUMN textbook_match_reason TEXT;
ALTER TABLE problems ADD COLUMN textbook_match_source TEXT NOT NULL DEFAULT 'unresolved'
  CHECK (textbook_match_source IN (
    'single_subject_textbook', 'metadata_match', 'ai_hint', 'user',
    'legacy_current_fallback', 'unresolved'
  ));
ALTER TABLE problems ADD COLUMN textbook_match_locked INTEGER NOT NULL DEFAULT 0
  CHECK (textbook_match_locked IN (0, 1));
ALTER TABLE problems ADD COLUMN textbook_match_updated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_problems_matched_textbook
  ON problems(matched_textbook_id, deleted_at);

CREATE TRIGGER IF NOT EXISTS trg_problem_textbook_match_subject_insert
BEFORE INSERT ON problems
WHEN NEW.matched_textbook_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM textbooks textbook
  WHERE textbook.id = NEW.matched_textbook_id
    AND textbook.subject = trim(COALESCE(NULLIF(NEW.user_subject, ''),
      NULLIF(NEW.ai_subject, ''), NULLIF(NEW.subject, '')))
)
BEGIN
  SELECT RAISE(ABORT, 'problem textbook must belong to the same subject');
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_textbook_match_subject_update
BEFORE UPDATE OF matched_textbook_id, user_subject, ai_subject, subject ON problems
WHEN NEW.matched_textbook_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM textbooks textbook
  WHERE textbook.id = NEW.matched_textbook_id
    AND textbook.subject = trim(COALESCE(NULLIF(NEW.user_subject, ''),
      NULLIF(NEW.ai_subject, ''), NULLIF(NEW.subject, '')))
)
BEGIN
  SELECT RAISE(ABORT, 'problem textbook must belong to the same subject');
END;
