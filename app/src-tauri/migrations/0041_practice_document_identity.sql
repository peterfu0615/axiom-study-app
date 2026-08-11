-- A logical document identity remains stable when the renderer implementation
-- changes. The content hash and file path are updated in place.
CREATE UNIQUE INDEX idx_practice_documents_logical_identity
  ON practice_documents(practice_set_id, attempt_id, document_type, layout_version);
