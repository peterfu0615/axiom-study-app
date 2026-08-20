CREATE TABLE planner_preferences (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  default_daily_capacity_minutes INTEGER NOT NULL DEFAULT 90
    CHECK (default_daily_capacity_minutes BETWEEN 15 AND 720),
  review_reserve_minutes INTEGER NOT NULL DEFAULT 25
    CHECK (review_reserve_minutes BETWEEN 5 AND 180),
  max_subject_block_minutes INTEGER NOT NULL DEFAULT 45
    CHECK (max_subject_block_minutes BETWEEN 10 AND 180),
  horizon_days INTEGER NOT NULL DEFAULT 14 CHECK (horizon_days BETWEEN 7 AND 42),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO planner_preferences(
  id, default_daily_capacity_minutes, review_reserve_minutes,
  max_subject_block_minutes, horizon_days, created_at, updated_at
) VALUES('default', 90, 25, 45, 14, unixepoch('now') * 1000, unixepoch('now') * 1000);

CREATE TABLE planner_availability (
  plan_date TEXT PRIMARY KEY NOT NULL,
  capacity_minutes INTEGER NOT NULL CHECK (capacity_minutes BETWEEN 0 AND 720),
  unavailable INTEGER NOT NULL DEFAULT 0 CHECK (unavailable IN (0, 1)),
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE planner_exams (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  subject TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 40),
  exam_date TEXT NOT NULL,
  chapter_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(chapter_ids_json)),
  knowledge_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(knowledge_tag_ids_json)),
  status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'completed', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_planner_exams_date ON planner_exams(status, exam_date);

CREATE TABLE planner_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  task_type TEXT NOT NULL CHECK (task_type IN ('review', 'correction', 'homework', 'exam_prep')),
  subject TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes BETWEEN 1 AND 1440),
  actual_minutes INTEGER CHECK (actual_minutes IS NULL OR actual_minutes BETWEEN 0 AND 1440),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  splittable INTEGER NOT NULL DEFAULT 1 CHECK (splittable IN (0, 1)),
  earliest_date TEXT NOT NULL,
  chapter_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(chapter_ids_json)),
  knowledge_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(knowledge_tag_ids_json)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  source_type TEXT NOT NULL DEFAULT 'user'
    CHECK (source_type IN ('user', 'review', 'correction', 'exam')),
  source_ref TEXT,
  exam_id TEXT REFERENCES planner_exams(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK (earliest_date <= due_date)
);

CREATE UNIQUE INDEX idx_planner_tasks_source
  ON planner_tasks(source_type, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX idx_planner_tasks_due ON planner_tasks(status, due_date, priority DESC);
CREATE INDEX idx_planner_tasks_subject ON planner_tasks(subject, status);

CREATE TABLE planner_schedule_runs (
  id TEXT PRIMARY KEY NOT NULL,
  start_date TEXT NOT NULL,
  horizon_days INTEGER NOT NULL,
  scheduler_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_planner_schedule_runs_created
  ON planner_schedule_runs(created_at DESC);

CREATE TABLE planner_task_segments (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  schedule_run_id TEXT NOT NULL,
  planned_date TEXT NOT NULL,
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes BETWEEN 1 AND 720),
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'skipped')),
  actual_minutes INTEGER CHECK (actual_minutes IS NULL OR actual_minutes BETWEEN 0 AND 720),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES planner_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_run_id) REFERENCES planner_schedule_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_planner_segments_date
  ON planner_task_segments(planned_date, order_index);
CREATE INDEX idx_planner_segments_task
  ON planner_task_segments(task_id, status);

CREATE TRIGGER trg_planner_completed_task_requires_time
BEFORE UPDATE OF status ON planner_tasks
WHEN NEW.status = 'completed' AND NEW.completed_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'completed planner task requires completed_at');
END;
