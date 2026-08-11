-- Practice Loop owns orchestration only. Learning-state transitions continue
-- through the existing ReviewAttempt -> TagEvidence -> HorizonReviewLog path.
ALTER TABLE review_attempts ADD COLUMN evidence_source TEXT NOT NULL DEFAULT 'today_review'
  CHECK (evidence_source IN ('today_review', 'practice_attempt'));

CREATE TABLE practice_loops (
  id TEXT PRIMARY KEY NOT NULL,
  root_practice_set_id TEXT NOT NULL,
  current_practice_set_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'needs_reinforcement', 'mastered', 'stopped')),
  round_index INTEGER NOT NULL DEFAULT 1 CHECK (round_index >= 1),
  item_budget INTEGER NOT NULL CHECK (item_budget BETWEEN 1 AND 36),
  consumed_items INTEGER NOT NULL DEFAULT 0 CHECK (consumed_items BETWEEN 0 AND item_budget),
  stop_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (root_practice_set_id) REFERENCES practice_sets(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_practice_set_id) REFERENCES practice_sets(id) ON DELETE RESTRICT,
  UNIQUE (root_practice_set_id)
);

CREATE TABLE practice_loop_rounds (
  id TEXT PRIMARY KEY NOT NULL,
  practice_loop_id TEXT NOT NULL,
  practice_set_id TEXT NOT NULL,
  round_index INTEGER NOT NULL CHECK (round_index >= 1),
  source_attempt_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (practice_loop_id) REFERENCES practice_loops(id) ON DELETE CASCADE,
  FOREIGN KEY (practice_set_id) REFERENCES practice_sets(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_attempt_id) REFERENCES practice_attempts(id) ON DELETE RESTRICT,
  UNIQUE (practice_loop_id, round_index),
  UNIQUE (practice_set_id)
);

CREATE TABLE practice_evidences (
  id TEXT PRIMARY KEY NOT NULL,
  practice_loop_id TEXT NOT NULL,
  practice_attempt_id TEXT NOT NULL,
  practice_response_id TEXT NOT NULL,
  review_attempt_id TEXT NOT NULL,
  grading_snapshot_json TEXT NOT NULL CHECK (json_valid(grading_snapshot_json)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (practice_loop_id) REFERENCES practice_loops(id) ON DELETE CASCADE,
  FOREIGN KEY (practice_attempt_id) REFERENCES practice_attempts(id) ON DELETE RESTRICT,
  FOREIGN KEY (practice_response_id) REFERENCES practice_responses(id) ON DELETE RESTRICT,
  FOREIGN KEY (review_attempt_id) REFERENCES review_attempts(id) ON DELETE RESTRICT,
  UNIQUE (practice_response_id),
  UNIQUE (review_attempt_id)
);

CREATE INDEX idx_practice_loops_status ON practice_loops(status, updated_at DESC);
CREATE INDEX idx_practice_evidences_attempt ON practice_evidences(practice_attempt_id, created_at);

-- Once submitted, the exact grading snapshot is immutable. A correction must
-- happen before submission; rescanning cannot silently rewrite SkillState history.
CREATE TRIGGER trg_practice_response_evidence_immutable_update
BEFORE UPDATE ON practice_responses
WHEN EXISTS (SELECT 1 FROM practice_evidences evidence WHERE evidence.practice_response_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'submitted practice response is immutable');
END;

CREATE TRIGGER trg_practice_response_evidence_immutable_delete
BEFORE DELETE ON practice_responses
WHEN EXISTS (SELECT 1 FROM practice_evidences evidence WHERE evidence.practice_response_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'submitted practice response is immutable');
END;

CREATE TRIGGER trg_practice_attempt_completed_terminal
BEFORE UPDATE OF status ON practice_attempts
WHEN OLD.status='completed' AND NEW.status!='completed'
BEGIN
  SELECT RAISE(ABORT, 'completed practice attempt is terminal');
END;
