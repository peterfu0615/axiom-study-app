-- Preserve what can still be audited after the historical tree flattening and
-- make the two-level curriculum contract strict for future writes.
-- 0024 is intentionally not edited: databases that already applied it must
-- receive an append-only repair.

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS curriculum_repair_events (
  id TEXT PRIMARY KEY NOT NULL,
  migration_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  subject TEXT,
  textbook_id TEXT,
  entity_id TEXT,
  source_id TEXT,
  target_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_curriculum_repair_events_scope
  ON curriculum_repair_events(subject, textbook_id, created_at);

-- 0024 rewrote these snapshots before this audit table existed.  The original
-- node id cannot be inferred reliably from the rewritten row, so record the
-- limitation without pretending to restore history.
INSERT OR IGNORE INTO curriculum_repair_events (
  id, migration_version, event_type, subject, textbook_id, entity_id,
  target_id, metadata_json, created_at
)
SELECT
  '0024-revision-pointer-audit-' || revision.id,
  24,
  'revision_pointer_already_rewritten',
  revision.subject,
  node.textbook_id,
  revision.id,
  revision.knowledge_node_id,
  '{"note":"0024 may have rewritten this historical pointer; original node id is not recoverable from the current row"}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM tag_definition_revisions revision
LEFT JOIN knowledge_nodes node ON node.id = revision.knowledge_node_id
WHERE revision.knowledge_node_id IS NOT NULL;

-- 0024 created replacement ids for rewritten edges.  Keep a durable audit
-- marker for those rows; the deleted pre-0024 ids cannot be recreated from the
-- current database.
INSERT OR IGNORE INTO curriculum_repair_events (
  id, migration_version, event_type, subject, textbook_id, entity_id,
  metadata_json, created_at
)
SELECT
  '0024-edge-id-audit-' || edge.id,
  24,
  'edge_id_rewritten_by_0024',
  edge.subject,
  source.textbook_id,
  edge.id,
  '{"note":"0024 replaced the original edge id; endpoint metadata remains available"}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM knowledge_edges edge
JOIN knowledge_nodes source ON source.id = edge.from_node_id
WHERE edge.id LIKE 'migration-edge-%';

-- The older sibling index can make a repaired endpoint or fallback chapter
-- fail before its survivor is selected.  Recreate it after normalization.
DROP INDEX IF EXISTS idx_knowledge_nodes_sibling_name;

CREATE TEMP TABLE axiom_node_redirect (
  source_id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL
);

WITH RECURSIVE redirect(source_id, target_id, depth) AS (
  SELECT id, merged_into_id, 0
  FROM knowledge_nodes
  WHERE merged_into_id IS NOT NULL
  UNION ALL
  SELECT redirect.source_id, target.merged_into_id, redirect.depth + 1
  FROM redirect
  JOIN knowledge_nodes target ON target.id = redirect.target_id
  WHERE target.merged_into_id IS NOT NULL AND redirect.depth < 100
)
INSERT OR IGNORE INTO axiom_node_redirect (source_id, target_id)
SELECT redirect.source_id, redirect.target_id
FROM redirect
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_nodes terminal
  WHERE terminal.id = redirect.target_id AND terminal.merged_into_id IS NOT NULL
);

-- Enforce one active unclassified chapter per textbook even if a prior repair
-- or a hand-edited database left duplicate fallback chapters behind.
CREATE TEMP TABLE axiom_unclassified_merge (
  source_id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL
);

WITH ranked AS (
  SELECT node.id,
    first_value(node.id) OVER (
      PARTITION BY node.subject, node.textbook_id
      ORDER BY node.created_at, node.id
    ) AS target_id,
    row_number() OVER (
      PARTITION BY node.subject, node.textbook_id
      ORDER BY node.created_at, node.id
    ) AS duplicate_rank
  FROM knowledge_nodes node
  WHERE node.node_type = 'chapter'
    AND node.is_unclassified = 1
    AND node.archived_at IS NULL
    AND node.merged_into_id IS NULL
)
INSERT INTO axiom_unclassified_merge (source_id, target_id)
SELECT id, target_id FROM ranked WHERE duplicate_rank > 1;

INSERT OR IGNORE INTO axiom_node_redirect (source_id, target_id)
SELECT source_id, target_id FROM axiom_unclassified_merge;

INSERT OR IGNORE INTO curriculum_repair_events (
  id, migration_version, event_type, subject, textbook_id, entity_id,
  source_id, target_id, metadata_json, created_at
)
SELECT
  '0026-unclassified-merge-' || source.id,
  26,
  'duplicate_unclassified_chapter_merged',
  source.subject,
  source.textbook_id,
  source.id,
  source.id,
  merge.target_id,
  '{"note":"duplicate fallback chapter merged into the oldest active fallback"}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM axiom_unclassified_merge merge
JOIN knowledge_nodes source ON source.id = merge.source_id;

-- 0024 repaired the normal legacy paths, but it could not protect a database
-- that was edited while an older trigger still allowed a child below an
-- archived chapter.  Repair such active orphans before rebuilding NOT NULL
-- paths; they must never remain root-level knowledge nodes.
CREATE TEMP TABLE axiom_orphan_textbooks (
  textbook_id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL
);

INSERT OR IGNORE INTO axiom_orphan_textbooks (textbook_id, subject)
SELECT DISTINCT node.textbook_id, node.subject
FROM knowledge_nodes node
LEFT JOIN knowledge_nodes parent ON parent.id = node.parent_id
WHERE node.archived_at IS NULL
  AND node.node_type != 'chapter'
  AND (
    node.parent_id IS NULL
    OR parent.id IS NULL
    OR parent.node_type != 'chapter'
    OR parent.archived_at IS NOT NULL
    OR parent.merged_into_id IS NOT NULL
    OR parent.subject != node.subject
    OR parent.textbook_id != node.textbook_id
  );

INSERT OR IGNORE INTO knowledge_nodes (
  id, textbook_id, subject, canonical_name, node_type, parent_id, path,
  sort_order, curriculum_version, description, source_page_start, source_page_end,
  evidence_text, source_path, extraction_method, confidence, verification_status,
  is_unclassified, created_at, updated_at
)
SELECT
  'curriculum-unclassified-' || textbook.id,
  textbook.id,
  textbook.subject,
  '待归类知识点',
  'chapter',
  NULL,
  '待归类知识点',
  2147483000,
  1,
  '由追加式安全修复迁移无法归类的知识点。',
  NULL,
  NULL,
  '迁移 0026：原父章节不可用。',
  textbook.source_path,
  'manual',
  0,
  'needs_review',
  1,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM axiom_orphan_textbooks orphan
JOIN textbooks textbook ON textbook.id = orphan.textbook_id
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_nodes fallback
  WHERE fallback.textbook_id = textbook.id
    AND fallback.node_type = 'chapter'
    AND fallback.is_unclassified = 1
    AND fallback.archived_at IS NULL
    AND fallback.merged_into_id IS NULL
);

-- A previous run may have left the deterministic fallback id archived or
-- merged.  Do not revive that historical row silently: create a new active
-- fallback id while retaining the old row for auditability.
INSERT OR IGNORE INTO knowledge_nodes (
  id, textbook_id, subject, canonical_name, node_type, parent_id, path,
  sort_order, curriculum_version, description, source_page_start, source_page_end,
  evidence_text, source_path, extraction_method, confidence, verification_status,
  is_unclassified, created_at, updated_at
)
SELECT
  'curriculum-unclassified-' || textbook.id || '-' || lower(hex(randomblob(16))),
  textbook.id,
  textbook.subject,
  '待归类知识点',
  'chapter',
  NULL,
  '待归类知识点',
  2147483000,
  1,
  '由追加式安全修复迁移无法归类的知识点。',
  NULL,
  NULL,
  '迁移 0026：原父章节不可用。',
  textbook.source_path,
  'manual',
  0,
  'needs_review',
  1,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM axiom_orphan_textbooks orphan
JOIN textbooks textbook ON textbook.id = orphan.textbook_id
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_nodes fallback
  WHERE fallback.textbook_id = textbook.id
    AND fallback.node_type = 'chapter'
    AND fallback.is_unclassified = 1
    AND fallback.archived_at IS NULL
    AND fallback.merged_into_id IS NULL
);

UPDATE knowledge_nodes
SET node_type = 'knowledge',
    parent_id = (
      SELECT fallback.id FROM knowledge_nodes fallback
      WHERE fallback.textbook_id = knowledge_nodes.textbook_id
        AND fallback.subject = knowledge_nodes.subject
        AND fallback.node_type = 'chapter'
        AND fallback.is_unclassified = 1
        AND fallback.archived_at IS NULL
        AND fallback.merged_into_id IS NULL
      ORDER BY fallback.created_at, fallback.id
      LIMIT 1
    ),
    is_unclassified = 0,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE knowledge_nodes.archived_at IS NULL
  AND knowledge_nodes.node_type != 'chapter'
  AND NOT EXISTS (
    SELECT 1 FROM knowledge_nodes parent
    WHERE parent.id = knowledge_nodes.parent_id
      AND parent.node_type = 'chapter'
      AND parent.archived_at IS NULL
      AND parent.merged_into_id IS NULL
      AND parent.subject = knowledge_nodes.subject
      AND parent.textbook_id = knowledge_nodes.textbook_id
  );

UPDATE knowledge_nodes
SET parent_id = (
  SELECT target_id FROM axiom_node_redirect
  WHERE source_id = knowledge_nodes.parent_id
)
WHERE parent_id IN (SELECT source_id FROM axiom_node_redirect);

-- Current references follow the survivor.  Historical revisions deliberately
-- do not appear here: they remain snapshots of the state that was recorded.
UPDATE tag_definitions
SET knowledge_node_id = (
  SELECT target_id FROM axiom_node_redirect
  WHERE source_id = tag_definitions.knowledge_node_id
)
WHERE knowledge_node_id IN (SELECT source_id FROM axiom_node_redirect);

INSERT OR IGNORE INTO curriculum_tag_knowledge_links (
  tag_id, knowledge_node_id, source, confidence, created_at
)
SELECT links.tag_id, redirect.target_id, links.source, links.confidence, links.created_at
FROM curriculum_tag_knowledge_links links
JOIN axiom_node_redirect redirect ON redirect.source_id = links.knowledge_node_id;

DELETE FROM curriculum_tag_knowledge_links
WHERE knowledge_node_id IN (SELECT source_id FROM axiom_node_redirect);

-- Normalize edge endpoints in place whenever possible.  The original edge id
-- and all metadata stay intact.  If normalization creates a duplicate or a
-- self-edge, record the decision before removing the invalid duplicate.
CREATE TEMP TABLE axiom_edge_rewrite AS
SELECT edge.id, edge.subject, edge.from_node_id, edge.to_node_id,
  COALESCE(from_redirect.target_id, edge.from_node_id) AS new_from_node_id,
  COALESCE(to_redirect.target_id, edge.to_node_id) AS new_to_node_id,
  edge.relation_type, edge.created_at
FROM knowledge_edges edge
LEFT JOIN axiom_node_redirect from_redirect ON from_redirect.source_id = edge.from_node_id
LEFT JOIN axiom_node_redirect to_redirect ON to_redirect.source_id = edge.to_node_id;

INSERT OR IGNORE INTO curriculum_repair_events (
  id, migration_version, event_type, subject, entity_id, source_id,
  target_id, metadata_json, created_at
)
SELECT
  '0026-edge-endpoint-' || rewrite.id,
  26,
  'edge_endpoint_normalized',
  rewrite.subject,
  rewrite.id,
  rewrite.from_node_id,
  rewrite.new_from_node_id,
  '{"note":"edge endpoints updated in place; edge id and metadata preserved"}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM axiom_edge_rewrite rewrite
WHERE rewrite.from_node_id != rewrite.new_from_node_id
   OR rewrite.to_node_id != rewrite.new_to_node_id;

CREATE TEMP TABLE axiom_edge_rank AS
SELECT rewrite.*,
  row_number() OVER (
    PARTITION BY rewrite.subject, rewrite.new_from_node_id,
      rewrite.new_to_node_id, rewrite.relation_type
    ORDER BY rewrite.created_at, rewrite.id
  ) AS duplicate_rank
FROM axiom_edge_rewrite rewrite
WHERE rewrite.new_from_node_id != rewrite.new_to_node_id;

INSERT OR IGNORE INTO curriculum_repair_events (
  id, migration_version, event_type, subject, entity_id, source_id,
  target_id, metadata_json, created_at
)
SELECT
  '0026-edge-duplicate-' || ranked.id,
  26,
  'duplicate_edge_archived',
  ranked.subject,
  ranked.id,
  ranked.id,
  (
    SELECT survivor.id FROM axiom_edge_rank survivor
    WHERE survivor.subject = ranked.subject
      AND survivor.new_from_node_id = ranked.new_from_node_id
      AND survivor.new_to_node_id = ranked.new_to_node_id
      AND survivor.relation_type = ranked.relation_type
      AND survivor.duplicate_rank = 1
  ),
  '{"note":"duplicate edge kept an auditable survivor selected by created_at and id"}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM axiom_edge_rank ranked
WHERE ranked.duplicate_rank > 1;

INSERT OR IGNORE INTO curriculum_repair_events (
  id, migration_version, event_type, subject, entity_id, source_id,
  target_id, metadata_json, created_at
)
SELECT
  '0026-edge-self-' || ranked.id,
  26,
  'self_edge_archived',
  ranked.subject,
  ranked.id,
  ranked.id,
  NULL,
  '{"note":"endpoint normalization would create a self-edge, which is invalid by schema"}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM axiom_edge_rewrite ranked
WHERE ranked.new_from_node_id = ranked.new_to_node_id;

DELETE FROM knowledge_edges
WHERE id IN (
  SELECT id FROM axiom_edge_rank WHERE duplicate_rank > 1
  UNION ALL
  SELECT id FROM axiom_edge_rewrite WHERE new_from_node_id = new_to_node_id
);

UPDATE knowledge_edges
SET from_node_id = (
      SELECT new_from_node_id FROM axiom_edge_rewrite
      WHERE id = knowledge_edges.id
    ),
    to_node_id = (
      SELECT new_to_node_id FROM axiom_edge_rewrite
      WHERE id = knowledge_edges.id
    )
WHERE id IN (
  SELECT id FROM axiom_edge_rank WHERE duplicate_rank = 1
);

UPDATE knowledge_nodes
SET merged_into_id = (
      SELECT target_id FROM axiom_node_redirect
      WHERE source_id = knowledge_nodes.id
    ),
    archived_at = COALESCE(archived_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (SELECT source_id FROM axiom_node_redirect);

UPDATE knowledge_nodes
SET path = canonical_name,
    parent_id = NULL
WHERE node_type = 'chapter';

UPDATE knowledge_nodes
SET path = (
  SELECT parent.path || '/' || knowledge_nodes.canonical_name
  FROM knowledge_nodes parent
  WHERE parent.id = knowledge_nodes.parent_id
    AND parent.node_type = 'chapter'
    AND parent.archived_at IS NULL
    AND parent.merged_into_id IS NULL
),
    is_unclassified = 0
WHERE node_type = 'knowledge' AND archived_at IS NULL;

CREATE TEMP TABLE axiom_node_sort (
  node_id TEXT PRIMARY KEY NOT NULL,
  sort_order INTEGER NOT NULL
);

WITH ordered AS (
  SELECT node.id,
    row_number() OVER (
      PARTITION BY node.textbook_id, node.parent_id
      ORDER BY COALESCE(node.source_page_start, 2147483000),
        node.sort_order, node.created_at, node.id
    ) - 1 AS next_sort_order
  FROM knowledge_nodes node
  WHERE node.archived_at IS NULL
)
INSERT INTO axiom_node_sort (node_id, sort_order)
SELECT id, next_sort_order FROM ordered;

UPDATE knowledge_nodes
SET sort_order = (
  SELECT sort_order FROM axiom_node_sort
  WHERE node_id = knowledge_nodes.id
)
WHERE id IN (SELECT node_id FROM axiom_node_sort);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_nodes_sibling_name
  ON knowledge_nodes(subject, textbook_id, ifnull(parent_id, ''), node_type, canonical_name COLLATE NOCASE)
  WHERE archived_at IS NULL AND merged_into_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_nodes_one_unclassified_chapter
  ON knowledge_nodes(subject, textbook_id)
  WHERE node_type = 'chapter'
    AND is_unclassified = 1
    AND archived_at IS NULL
    AND merged_into_id IS NULL;

DROP TRIGGER IF EXISTS trg_knowledge_node_two_level_insert;
DROP TRIGGER IF EXISTS trg_knowledge_node_two_level_update;
DROP TRIGGER IF EXISTS trg_knowledge_node_archive_chapter_with_children;

CREATE TRIGGER trg_knowledge_node_two_level_insert
BEFORE INSERT ON knowledge_nodes
WHEN (NEW.parent_id IS NULL AND NEW.node_type != 'chapter')
  OR (NEW.parent_id IS NOT NULL AND (
    NEW.node_type != 'knowledge' OR NOT EXISTS (
      SELECT 1 FROM knowledge_nodes parent
      WHERE parent.id = NEW.parent_id
        AND parent.node_type = 'chapter'
        AND parent.archived_at IS NULL
        AND parent.merged_into_id IS NULL
        AND parent.subject = NEW.subject
        AND parent.textbook_id = NEW.textbook_id
    )
  ))
BEGIN
  SELECT RAISE(ABORT, 'curriculum nodes must use active chapter -> knowledge structure');
END;

CREATE TRIGGER trg_knowledge_node_two_level_update
BEFORE UPDATE OF parent_id, node_type, subject, textbook_id, archived_at, merged_into_id ON knowledge_nodes
WHEN (NEW.parent_id IS NULL AND NEW.node_type != 'chapter')
  OR (NEW.parent_id IS NOT NULL AND (
    NEW.node_type != 'knowledge' OR NOT EXISTS (
      SELECT 1 FROM knowledge_nodes parent
      WHERE parent.id = NEW.parent_id
        AND parent.node_type = 'chapter'
        AND parent.archived_at IS NULL
        AND parent.merged_into_id IS NULL
        AND parent.subject = NEW.subject
        AND parent.textbook_id = NEW.textbook_id
    )
  ))
BEGIN
  SELECT RAISE(ABORT, 'curriculum nodes must use active chapter -> knowledge structure');
END;

CREATE TRIGGER trg_knowledge_node_archive_chapter_with_children
BEFORE UPDATE OF archived_at ON knowledge_nodes
WHEN NEW.node_type = 'chapter'
  AND OLD.archived_at IS NULL
  AND NEW.archived_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM knowledge_nodes child
    WHERE child.parent_id = NEW.id
      AND child.archived_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot archive a chapter while it has active knowledge points');
END;

DROP TABLE axiom_node_sort;
DROP TABLE axiom_edge_rank;
DROP TABLE axiom_edge_rewrite;
DROP TABLE axiom_unclassified_merge;
DROP TABLE axiom_node_redirect;

COMMIT;
