-- Keep Review history and Insights joins indexed at larger library sizes.

CREATE INDEX IF NOT EXISTS idx_question_instances_review_module
  ON question_instances(review_module_id);

CREATE INDEX IF NOT EXISTS idx_review_sessions_history_date
  ON review_sessions(session_date, id);
