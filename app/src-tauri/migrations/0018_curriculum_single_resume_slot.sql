-- Curriculum imports remain ephemeral until the first AI request starts.
-- Only the latest complete AI-stage checkpoint is migrated into the single slot.
DROP INDEX IF EXISTS idx_curriculum_import_jobs_open;
DROP INDEX IF EXISTS idx_curriculum_import_jobs_textbook;

ALTER TABLE curriculum_import_jobs RENAME TO curriculum_import_jobs_legacy;

CREATE TABLE curriculum_import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  original_source_path TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'directory_image')),
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'ai_analyzing_structure',
    'ai_generating_tags',
    'ai_auditing',
    'waiting_for_review',
    'ai_failed_recoverable'
  )),
  resume_stage TEXT NOT NULL CHECK (resume_stage IN (
    'ai_analyzing_structure',
    'ai_generating_tags',
    'ai_auditing',
    'waiting_for_review'
  )),
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  extraction_method TEXT NOT NULL CHECK (
    extraction_method IN ('pdf_text', 'vision_ocr', 'mixed')
  ),
  extraction_json TEXT NOT NULL,
  metadata_json TEXT,
  structure_json TEXT,
  tags_json TEXT,
  audit_json TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_task_id TEXT,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  raw_output TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A constant-expression partial unique index enforces the one-slot invariant
-- even if two windows attempt to start an AI import concurrently.
CREATE UNIQUE INDEX idx_curriculum_import_single_resume_slot
  ON curriculum_import_jobs((1))
  WHERE status IN (
    'ai_analyzing_structure',
    'ai_generating_tags',
    'ai_auditing',
    'waiting_for_review',
    'ai_failed_recoverable'
  );

CREATE TABLE curriculum_import_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES curriculum_import_jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN (
    'ai_analyzing_structure', 'ai_generating_tags', 'ai_auditing'
  )),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider_task_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'superseded')),
  raw_output TEXT,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(job_id, stage, attempt_number)
);

CREATE INDEX idx_curriculum_import_attempts_job
  ON curriculum_import_attempts(job_id, started_at DESC);

-- Old `needs_review` rows are safe completed-AI checkpoints. Old failed rows
-- are retained only when full extraction and provider identity are present.
INSERT INTO curriculum_import_jobs (
  id, original_source_path, source_path, source_name, source_type, content_hash,
  status, resume_stage, page_count, extraction_method, extraction_json,
  metadata_json, provider, model, prompt_version, schema_version, input_hash,
  raw_output, error_message, created_at, updated_at
)
SELECT id, source_path, source_path, source_name, source_type, content_hash,
  CASE WHEN status = 'needs_review' THEN 'waiting_for_review'
       ELSE 'ai_failed_recoverable' END,
  CASE WHEN status = 'needs_review' THEN 'waiting_for_review'
       ELSE 'ai_analyzing_structure' END,
  page_count, extraction_method, extraction_json, metadata_json,
  provider, model, prompt_version, schema_version, input_hash,
  raw_output, error_message, created_at, updated_at
FROM curriculum_import_jobs_legacy
WHERE id = (
  SELECT id FROM curriculum_import_jobs_legacy
  WHERE status IN ('needs_review', 'failed')
    AND source_type IN ('pdf', 'directory_image')
    AND content_hash IS NOT NULL
    AND page_count > 0
    AND extraction_method IN ('pdf_text', 'vision_ocr', 'mixed')
    AND extraction_json IS NOT NULL
    AND provider IS NOT NULL AND model IS NOT NULL
    AND prompt_version IS NOT NULL AND schema_version IS NOT NULL
    AND input_hash IS NOT NULL
  ORDER BY updated_at DESC
  LIMIT 1
);

DROP TABLE curriculum_import_jobs_legacy;
