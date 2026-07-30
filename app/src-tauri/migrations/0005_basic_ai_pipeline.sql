ALTER TABLE problems ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'not_started'
  CHECK (ai_status IN (
    'not_started',
    'pending',
    'processing',
    'completed',
    'failed'
  ));
ALTER TABLE problems ADD COLUMN ai_active_model_run_id TEXT;
ALTER TABLE problems ADD COLUMN ai_subject TEXT;
ALTER TABLE problems ADD COLUMN ai_problem_type TEXT;
ALTER TABLE problems ADD COLUMN ai_stem_markdown TEXT;
ALTER TABLE problems ADD COLUMN ai_choices_json TEXT;
ALTER TABLE problems ADD COLUMN ai_has_diagram INTEGER;
ALTER TABLE problems ADD COLUMN ai_diagram_bbox_json TEXT;
ALTER TABLE problems ADD COLUMN ai_knowledge_points_json TEXT;
ALTER TABLE problems ADD COLUMN ai_confidence REAL;
ALTER TABLE problems ADD COLUMN ai_warnings_json TEXT;
ALTER TABLE problems ADD COLUMN ai_updated_at INTEGER;

ALTER TABLE model_runs ADD COLUMN task_type TEXT NOT NULL
  DEFAULT 'analyze_problem_image';
ALTER TABLE model_runs ADD COLUMN input_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE model_runs ADD COLUMN error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_problems_ai_status
  ON problems(ai_status, updated_at);

CREATE INDEX IF NOT EXISTS idx_model_runs_problem_task
  ON model_runs(problem_id, task_type, created_at DESC);
