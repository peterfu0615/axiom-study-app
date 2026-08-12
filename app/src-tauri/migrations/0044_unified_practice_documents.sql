PRAGMA defer_foreign_keys = ON;

ALTER TABLE practice_documents RENAME TO practice_documents_legacy;
ALTER TABLE practice_document_pages RENAME TO practice_document_pages_legacy;
ALTER TABLE practice_answer_regions RENAME TO practice_answer_regions_legacy;
ALTER TABLE practice_attempt_pages RENAME TO practice_attempt_pages_legacy;

DROP INDEX idx_practice_documents_set;
DROP INDEX idx_practice_documents_attempt;
DROP INDEX idx_practice_documents_logical_identity;
DROP INDEX idx_practice_answer_regions_item;

CREATE TABLE practice_documents (
  id TEXT PRIMARY KEY NOT NULL,
  practice_set_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('questions', 'answer_sheet', 'solutions', 'complete')),
  layout_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  file_path TEXT,
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (practice_set_id) REFERENCES practice_sets(id) ON DELETE CASCADE,
  UNIQUE (practice_set_id, attempt_id, document_type, layout_version, content_hash)
);

CREATE INDEX idx_practice_documents_set
  ON practice_documents(practice_set_id, created_at DESC);
CREATE INDEX idx_practice_documents_attempt
  ON practice_documents(attempt_id);
CREATE UNIQUE INDEX idx_practice_documents_logical_identity
  ON practice_documents(practice_set_id, attempt_id, document_type, layout_version);

CREATE TABLE practice_document_pages (
  id TEXT PRIMARY KEY NOT NULL,
  practice_document_id TEXT NOT NULL,
  page_index INTEGER NOT NULL CHECK (page_index >= 0),
  page_identity TEXT NOT NULL UNIQUE,
  qr_payload TEXT NOT NULL,
  width_points REAL NOT NULL CHECK (width_points > 0),
  height_points REAL NOT NULL CHECK (height_points > 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (practice_document_id) REFERENCES practice_documents(id) ON DELETE CASCADE,
  UNIQUE (practice_document_id, page_index)
);

CREATE TABLE practice_answer_regions (
  id TEXT PRIMARY KEY NOT NULL,
  practice_document_page_id TEXT NOT NULL,
  practice_item_id TEXT NOT NULL,
  region_index INTEGER NOT NULL CHECK (region_index >= 0),
  x REAL NOT NULL CHECK (x >= 0 AND x <= 1),
  y REAL NOT NULL CHECK (y >= 0 AND y <= 1),
  width REAL NOT NULL CHECK (width > 0 AND x + width <= 1),
  height REAL NOT NULL CHECK (height > 0 AND y + height <= 1),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (practice_document_page_id) REFERENCES practice_document_pages(id) ON DELETE CASCADE,
  FOREIGN KEY (practice_item_id) REFERENCES practice_items(id) ON DELETE RESTRICT,
  UNIQUE (practice_document_page_id, practice_item_id, region_index)
);

CREATE INDEX idx_practice_answer_regions_item
  ON practice_answer_regions(practice_item_id);

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

INSERT INTO practice_documents
SELECT * FROM practice_documents_legacy;

INSERT INTO practice_document_pages
SELECT * FROM practice_document_pages_legacy;

INSERT INTO practice_answer_regions
SELECT * FROM practice_answer_regions_legacy;

INSERT INTO practice_attempt_pages
SELECT * FROM practice_attempt_pages_legacy;

DROP TABLE practice_attempt_pages_legacy;
DROP TABLE practice_answer_regions_legacy;
DROP TABLE practice_document_pages_legacy;
DROP TABLE practice_documents_legacy;
