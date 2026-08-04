-- B12: A textbook page whose rendering or OCR failed is persisted as an
-- explicit placeholder row (extraction_method = 'failed', empty evidence_text)
-- instead of silently disappearing from the imported book. Widen the
-- textbook_pages extraction_method domain with a table rebuild because SQLite
-- cannot alter CHECK constraints in place.

CREATE TABLE textbook_pages_new (
  id TEXT PRIMARY KEY NOT NULL,
  textbook_id TEXT NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  evidence_text TEXT NOT NULL DEFAULT '',
  source_path TEXT,
  extraction_method TEXT NOT NULL CHECK (
    extraction_method IN ('pdf_text', 'vision_ocr', 'manual', 'failed')
  ),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'ai_verified', 'user_verified', 'needs_review', 'rejected')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(textbook_id, subject) REFERENCES textbooks(id, subject),
  UNIQUE(textbook_id, page_number)
);

INSERT INTO textbook_pages_new (
  id, textbook_id, subject, page_number, evidence_text, source_path,
  extraction_method, confidence, verification_status, created_at, updated_at
)
SELECT id, textbook_id, subject, page_number, evidence_text, source_path,
  extraction_method, confidence, verification_status, created_at, updated_at
FROM textbook_pages;

DROP TABLE textbook_pages;

ALTER TABLE textbook_pages_new RENAME TO textbook_pages;
