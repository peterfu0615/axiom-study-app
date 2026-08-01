-- Course workspace import jobs are intentionally independent from model_runs:
-- a textbook can be recognized before it has a Problem row.  Keeping the
-- input hash, provider identity and raw response here makes the import
-- recoverable without weakening the existing Problem/ModelRun constraints.
CREATE TABLE IF NOT EXISTS curriculum_import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  source_path TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_type TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'extracting', 'recognizing', 'needs_review', 'completed', 'failed', 'cancelled')
  ),
  stage TEXT NOT NULL DEFAULT 'select_file' CHECK (
    stage IN ('select_file', 'preview', 'extracting', 'recognizing', 'confirm_info', 'review_structure', 'completed')
  ),
  page_count INTEGER,
  extraction_method TEXT,
  extraction_json TEXT,
  metadata_json TEXT,
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  input_hash TEXT,
  raw_output TEXT,
  error_message TEXT,
  textbook_id TEXT REFERENCES textbooks(id) ON DELETE SET NULL,
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_curriculum_import_jobs_open
  ON curriculum_import_jobs(status, updated_at DESC)
  WHERE status IN ('pending', 'extracting', 'recognizing', 'needs_review', 'failed');

CREATE INDEX IF NOT EXISTS idx_curriculum_import_jobs_textbook
  ON curriculum_import_jobs(textbook_id, updated_at DESC);

-- Do not alter the existing status CHECK on tag_relabel_batches.  A paused
-- batch remains processing in storage and exposes its pause state through the
-- nullable timestamp, preserving compatibility with all older local DBs.
ALTER TABLE tag_relabel_batches ADD COLUMN paused_at INTEGER;
