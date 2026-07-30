ALTER TABLE source_documents ADD COLUMN page_detection_json TEXT;
ALTER TABLE source_documents ADD COLUMN processed_width INTEGER;
ALTER TABLE source_documents ADD COLUMN processed_height INTEGER;
ALTER TABLE source_documents ADD COLUMN enhancement_mode TEXT;

CREATE TABLE IF NOT EXISTS document_processing_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  corrected_image_path TEXT,
  page_detected INTEGER NOT NULL,
  corners_json TEXT NOT NULL,
  text_lines_json TEXT NOT NULL,
  blocks_json TEXT NOT NULL,
  enhancement_mode TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processing_runs_source
  ON document_processing_runs(source_document_id, created_at DESC);
