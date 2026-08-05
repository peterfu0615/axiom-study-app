-- Migration 0027: Axiom 0.5.0 Learning Loop (SkillState, SkillBundle, ReviewSession, ReviewModule, QuestionInstance, ReviewAttempt, TagEvidence, ReviewLog)

CREATE TABLE IF NOT EXISTS skill_states (
  subject TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  mastery_estimate REAL NOT NULL DEFAULT 0.0,
  stability REAL NOT NULL DEFAULT 1.0,
  retrievability REAL NOT NULL DEFAULT 1.0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  transfer_score REAL NOT NULL DEFAULT 0.0,
  max_stable_difficulty REAL NOT NULL DEFAULT 0.0,
  last_practiced_at INTEGER,
  next_review_at INTEGER,
  uncertainty REAL NOT NULL DEFAULT 1.0,
  scheduler_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (subject, tag_id)
);

CREATE TABLE IF NOT EXISTS skill_bundles (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  primary_knowledge_tag_id TEXT NOT NULL,
  method_tag_ids_json TEXT NOT NULL DEFAULT '[]',
  model_tag_ids_json TEXT NOT NULL DEFAULT '[]',
  difficulty_context TEXT NOT NULL DEFAULT '中档',
  cluster_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_bundles_subject_key
  ON skill_bundles(subject, canonical_key);

CREATE TABLE IF NOT EXISTS skill_bundle_problems (
  skill_bundle_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  similarity_score REAL NOT NULL DEFAULT 1.0,
  role TEXT NOT NULL DEFAULT 'primary',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (skill_bundle_id, problem_id),
  FOREIGN KEY (skill_bundle_id) REFERENCES skill_bundles(id) ON DELETE CASCADE,
  FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS skill_bundle_states (
  subject TEXT NOT NULL,
  skill_bundle_id TEXT NOT NULL,
  mastery_estimate REAL NOT NULL DEFAULT 0.0,
  stability REAL NOT NULL DEFAULT 1.0,
  retrievability REAL NOT NULL DEFAULT 1.0,
  transfer_score REAL NOT NULL DEFAULT 0.0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  last_practiced_at INTEGER,
  next_review_at INTEGER,
  uncertainty REAL NOT NULL DEFAULT 1.0,
  scheduler_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (subject, skill_bundle_id),
  FOREIGN KEY (skill_bundle_id) REFERENCES skill_bundles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  session_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  mode TEXT NOT NULL DEFAULT 'standard',
  planned_problem_count INTEGER NOT NULL DEFAULT 2,
  estimated_duration_seconds INTEGER NOT NULL DEFAULT 600,
  pdf_path TEXT,
  submitted_asset_id TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS review_modules (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  session_id TEXT NOT NULL,
  skill_bundle_id TEXT NOT NULL,
  priority_score REAL NOT NULL DEFAULT 0.0,
  selection_reason TEXT NOT NULL,
  target_difficulty TEXT NOT NULL DEFAULT '中档',
  source_mode TEXT NOT NULL DEFAULT 'original',
  estimated_duration_seconds INTEGER NOT NULL DEFAULT 300,
  order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_bundle_id) REFERENCES skill_bundles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS question_instances (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  review_module_id TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'original',
  source_problem_id TEXT NOT NULL,
  variant_plan_id TEXT,
  stem_markdown TEXT NOT NULL,
  structured_content_json TEXT NOT NULL DEFAULT '{}',
  solution_json TEXT NOT NULL DEFAULT '{}',
  target_tags_json TEXT NOT NULL DEFAULT '{}',
  difficulty TEXT NOT NULL DEFAULT '中档',
  generation_model_run_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (review_module_id) REFERENCES review_modules(id) ON DELETE CASCADE,
  FOREIGN KEY (source_problem_id) REFERENCES problems(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  question_instance_id TEXT NOT NULL,
  answer_text TEXT,
  answer_image_path TEXT,
  is_correct INTEGER NOT NULL,
  first_error_step INTEGER,
  error_category TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 60,
  used_hint INTEGER NOT NULL DEFAULT 0,
  grading_confidence REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (question_instance_id) REFERENCES question_instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tag_evidences (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  review_attempt_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  skill_bundle_id TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'demonstrated',
  confidence REAL NOT NULL DEFAULT 1.0,
  weight REAL NOT NULL DEFAULT 1.0,
  evidence_text TEXT NOT NULL,
  transfer_flag INTEGER NOT NULL DEFAULT 0,
  difficulty_context TEXT NOT NULL DEFAULT '中档',
  model_run_id TEXT,
  user_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (review_attempt_id) REFERENCES review_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_bundle_id) REFERENCES skill_bundles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_logs (
  id TEXT PRIMARY KEY NOT NULL,
  review_attempt_id TEXT NOT NULL,
  skill_bundle_id TEXT NOT NULL,
  previous_state_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  new_state_json TEXT NOT NULL,
  scheduler_version INTEGER NOT NULL DEFAULT 1,
  reviewed_at INTEGER NOT NULL,
  FOREIGN KEY (review_attempt_id) REFERENCES review_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_bundle_id) REFERENCES skill_bundles(id) ON DELETE CASCADE
);
