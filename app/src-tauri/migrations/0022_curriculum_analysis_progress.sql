-- Persist curriculum analysis progress in the single resumable slot.  React
-- only caches these values; SQLite remains the source of truth across routes
-- and application restarts.
ALTER TABLE curriculum_import_jobs ADD COLUMN progress_current INTEGER NOT NULL DEFAULT 0
  CHECK (progress_current >= 0);
ALTER TABLE curriculum_import_jobs ADD COLUMN progress_total INTEGER NOT NULL DEFAULT 1
  CHECK (progress_total > 0);
ALTER TABLE curriculum_import_jobs ADD COLUMN progress_fraction REAL NOT NULL DEFAULT 0
  CHECK (progress_fraction BETWEEN 0 AND 1);
ALTER TABLE curriculum_import_jobs ADD COLUMN progress_label TEXT NOT NULL DEFAULT '';

UPDATE curriculum_import_jobs
SET progress_current = CASE WHEN status = 'waiting_for_review' THEN 1 ELSE 0 END,
    progress_total = 1,
    progress_fraction = CASE status
      WHEN 'ai_analyzing_structure' THEN 0.05
      WHEN 'ai_generating_tags' THEN 0.30
      WHEN 'ai_auditing' THEN 0.85
      WHEN 'waiting_for_review' THEN 1.0
      ELSE 0.05
    END,
    progress_label = CASE status
      WHEN 'ai_analyzing_structure' THEN '正在识别教材结构'
      WHEN 'ai_generating_tags' THEN '标签创建中'
      WHEN 'ai_auditing' THEN '正在检查分析结果'
      WHEN 'waiting_for_review' THEN '分析完成'
      WHEN 'ai_failed_recoverable' THEN '分析已暂停'
      ELSE '正在分析中'
    END;
