ALTER TABLE review_preferences ADD COLUMN target_retention REAL NOT NULL DEFAULT 0.85
  CHECK (target_retention BETWEEN 0.75 AND 0.95);
ALTER TABLE review_preferences ADD COLUMN variant_mode TEXT NOT NULL DEFAULT 'variant_preferred'
  CHECK (variant_mode IN ('variant_preferred', 'original_only'));

ALTER TABLE planner_tasks ADD COLUMN due_at INTEGER;
CREATE INDEX idx_planner_tasks_due_at ON planner_tasks(status, due_at);
CREATE INDEX idx_geometry_model_runs_queue
  ON model_runs(task_type, status, created_at) WHERE task_type='geometry_scene';

UPDATE planner_preferences
SET review_reserve_minutes=(
  SELECT MIN(180, MAX(5, max_daily_minutes)) FROM review_preferences WHERE id='default'
), updated_at=unixepoch('now') * 1000
WHERE id='default';

CREATE TABLE review_scheduler_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  state_kind TEXT NOT NULL CHECK (state_kind IN ('skill', 'bundle')),
  subject TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  previous_state_json TEXT NOT NULL CHECK (json_valid(previous_state_json)),
  new_state_json TEXT NOT NULL CHECK (json_valid(new_state_json)),
  migrated_at INTEGER NOT NULL,
  UNIQUE(state_kind, subject, entity_id, to_version)
);

CREATE INDEX idx_review_scheduler_migrations_version
  ON review_scheduler_migrations(to_version, migrated_at);
