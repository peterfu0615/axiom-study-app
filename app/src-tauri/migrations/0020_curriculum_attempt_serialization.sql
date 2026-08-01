-- Every AI stage owns at most one active attempt.  The job-side identity is
-- deliberately stored alongside the attempt row so a late provider response
-- cannot mutate a newer retry.
ALTER TABLE curriculum_import_jobs ADD COLUMN active_attempt_id TEXT;
ALTER TABLE curriculum_import_jobs ADD COLUMN active_attempt_number INTEGER;
ALTER TABLE curriculum_import_jobs ADD COLUMN stage_started_at INTEGER;
ALTER TABLE curriculum_import_jobs ADD COLUMN run_token TEXT;
ALTER TABLE curriculum_import_jobs ADD COLUMN run_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE curriculum_import_attempts ADD COLUMN run_token TEXT NOT NULL DEFAULT '';
ALTER TABLE curriculum_import_attempts ADD COLUMN run_generation INTEGER NOT NULL DEFAULT 0;

-- A few development builds wrote more than one `running` attempt before the
-- job state was updated.  Preserve their history, but make only the newest
-- record active before adding the invariant below.
UPDATE curriculum_import_attempts AS candidate
SET status = 'superseded',
    finished_at = COALESCE(finished_at, started_at)
WHERE status = 'running'
  AND EXISTS (
    SELECT 1
    FROM curriculum_import_attempts AS newer
    WHERE newer.job_id = candidate.job_id
      AND newer.stage = candidate.stage
      AND newer.status = 'running'
      AND (
        newer.started_at > candidate.started_at
        OR (newer.started_at = candidate.started_at AND newer.id > candidate.id)
      )
  );

-- Rehydrate active-job pointers for a checkpoint created by an earlier app
-- version.  New writes are exclusively made by the native transaction helper.
UPDATE curriculum_import_jobs AS job
SET active_attempt_id = (
      SELECT attempt.id
      FROM curriculum_import_attempts AS attempt
      WHERE attempt.job_id = job.id
        AND attempt.stage = job.resume_stage
        AND attempt.status = 'running'
      ORDER BY attempt.started_at DESC, attempt.id DESC
      LIMIT 1
    ),
    active_attempt_number = (
      SELECT attempt.attempt_number
      FROM curriculum_import_attempts AS attempt
      WHERE attempt.job_id = job.id
        AND attempt.stage = job.resume_stage
        AND attempt.status = 'running'
      ORDER BY attempt.started_at DESC, attempt.id DESC
      LIMIT 1
    ),
    run_token = (
      SELECT attempt.run_token
      FROM curriculum_import_attempts AS attempt
      WHERE attempt.job_id = job.id
        AND attempt.stage = job.resume_stage
        AND attempt.status = 'running'
      ORDER BY attempt.started_at DESC, attempt.id DESC
      LIMIT 1
    ),
    run_generation = COALESCE((
      SELECT attempt.run_generation
      FROM curriculum_import_attempts AS attempt
      WHERE attempt.job_id = job.id
        AND attempt.stage = job.resume_stage
        AND attempt.status = 'running'
      ORDER BY attempt.started_at DESC, attempt.id DESC
      LIMIT 1
    ), run_generation),
    stage_started_at = COALESCE(stage_started_at, updated_at)
WHERE status IN ('ai_analyzing_structure', 'ai_generating_tags', 'ai_auditing');

CREATE UNIQUE INDEX idx_curriculum_import_attempt_one_active_stage
  ON curriculum_import_attempts(job_id, stage)
  WHERE status = 'running';
