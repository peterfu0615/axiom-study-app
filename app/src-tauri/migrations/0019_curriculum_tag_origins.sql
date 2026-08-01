ALTER TABLE tag_definitions ADD COLUMN origin_kind TEXT NOT NULL DEFAULT 'user_created'
  CHECK (origin_kind IN (
    'textbook_extracted', 'ai_inferred', 'existing_library', 'user_created'
  ));

UPDATE tag_definitions
SET origin_kind = CASE source
  WHEN 'textbook' THEN 'textbook_extracted'
  WHEN 'model' THEN 'ai_inferred'
  WHEN 'user' THEN 'user_created'
  ELSE 'existing_library'
END;

CREATE TABLE curriculum_tag_knowledge_links (
  tag_id TEXT NOT NULL REFERENCES tag_definitions(id) ON DELETE CASCADE,
  knowledge_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('textbook_extracted', 'ai_inferred', 'user_created')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(tag_id, knowledge_node_id)
);
