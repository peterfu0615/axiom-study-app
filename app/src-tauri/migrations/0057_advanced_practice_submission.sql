CREATE TABLE practice_submission_assets (
  id TEXT PRIMARY KEY NOT NULL,
  practice_attempt_id TEXT NOT NULL,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('image', 'annotated_pdf', 'camera_scan')),
  original_asset_path TEXT NOT NULL,
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  annotations_preserved INTEGER NOT NULL DEFAULT 0 CHECK (annotations_preserved IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  status TEXT NOT NULL DEFAULT 'imported'
    CHECK (status IN ('imported', 'processing', 'completed', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (practice_attempt_id) REFERENCES practice_attempts(id) ON DELETE CASCADE
);

CREATE INDEX idx_practice_submission_assets_attempt
  ON practice_submission_assets(practice_attempt_id, created_at);

ALTER TABLE practice_attempt_pages ADD COLUMN submission_asset_id TEXT
  REFERENCES practice_submission_assets(id) ON DELETE SET NULL;
ALTER TABLE practice_attempt_pages ADD COLUMN source_page_index INTEGER
  CHECK (source_page_index IS NULL OR source_page_index >= 0);
ALTER TABLE practice_attempt_pages ADD COLUMN live_detection_confidence REAL
  CHECK (live_detection_confidence IS NULL OR live_detection_confidence BETWEEN 0 AND 1);

CREATE INDEX idx_practice_attempt_pages_submission
  ON practice_attempt_pages(submission_asset_id, source_page_index);
