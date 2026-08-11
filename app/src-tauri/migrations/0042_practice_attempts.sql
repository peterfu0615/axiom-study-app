CREATE TABLE practice_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  practice_set_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('capturing', 'captured', 'extracting', 'extracted', 'grading', 'completed', 'failed')),
  started_at INTEGER NOT NULL,
  submitted_at INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (practice_set_id) REFERENCES practice_sets(id) ON DELETE CASCADE
);

CREATE INDEX idx_practice_attempts_set
  ON practice_attempts(practice_set_id, created_at DESC);

CREATE TABLE practice_attempt_pages (
  id TEXT PRIMARY KEY NOT NULL,
  practice_attempt_id TEXT NOT NULL,
  practice_document_page_id TEXT NOT NULL,
  source_asset_path TEXT NOT NULL,
  corrected_asset_path TEXT NOT NULL,
  qr_payload TEXT NOT NULL,
  orientation_degrees INTEGER NOT NULL CHECK (orientation_degrees IN (0, 90, 180, 270)),
  geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
  status TEXT NOT NULL CHECK (status IN ('captured', 'failed')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (practice_attempt_id) REFERENCES practice_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (practice_document_page_id) REFERENCES practice_document_pages(id) ON DELETE RESTRICT,
  UNIQUE (practice_attempt_id, practice_document_page_id)
);

CREATE TABLE practice_responses (
  id TEXT PRIMARY KEY NOT NULL,
  practice_attempt_id TEXT NOT NULL,
  practice_item_id TEXT NOT NULL,
  answer_asset_path TEXT NOT NULL,
  extracted_answer_json TEXT CHECK (extracted_answer_json IS NULL OR json_valid(extracted_answer_json)),
  corrected_answer_json TEXT CHECK (corrected_answer_json IS NULL OR json_valid(corrected_answer_json)),
  grading_result_json TEXT CHECK (grading_result_json IS NULL OR json_valid(grading_result_json)),
  status TEXT NOT NULL CHECK (status IN ('captured', 'extracting', 'extracted', 'corrected', 'graded', 'needs_review')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (practice_attempt_id) REFERENCES practice_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (practice_item_id) REFERENCES practice_items(id) ON DELETE RESTRICT,
  UNIQUE (practice_attempt_id, practice_item_id)
);

CREATE INDEX idx_practice_responses_attempt
  ON practice_responses(practice_attempt_id, status);
