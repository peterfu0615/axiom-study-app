-- Flatten legacy textbook trees to chapter -> knowledge.
--
-- This migration is append-only.  It deliberately drops the sibling index
-- while the repair is running so section/detail nodes can be converted and
-- duplicate knowledge names can be merged in one transaction.  Node rows are
-- never deleted: merged rows retain their ids and point at their survivor.

BEGIN IMMEDIATE;

ALTER TABLE knowledge_nodes ADD COLUMN is_unclassified INTEGER NOT NULL DEFAULT 0
  CHECK (is_unclassified IN (0, 1));

DROP INDEX IF EXISTS idx_knowledge_nodes_sibling_name;

-- A legacy book was only a storage container.  Keep a book id as a chapter
-- when it has no real chapter children; otherwise archive the container and
-- promote its real chapters to roots below.
UPDATE knowledge_nodes
SET node_type = 'chapter', parent_id = NULL
WHERE node_type = 'book'
  AND archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM knowledge_nodes child
    WHERE child.parent_id = knowledge_nodes.id
      AND child.node_type = 'chapter'
      AND child.archived_at IS NULL
  );

UPDATE knowledge_nodes
SET archived_at = COALESCE(archived_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE node_type = 'book'
  AND archived_at IS NULL
  AND EXISTS (
    SELECT 1 FROM knowledge_nodes child
    WHERE child.parent_id = knowledge_nodes.id
      AND child.node_type = 'chapter'
      AND child.archived_at IS NULL
  );

UPDATE knowledge_nodes
SET parent_id = NULL
WHERE node_type = 'chapter' AND archived_at IS NULL;

-- Canonical names from older imports occasionally carried directory spacing.
-- Trim them before duplicate detection and path rebuilding so the repaired
-- two-level paths are stable without changing the underlying node ids.
UPDATE knowledge_nodes
SET canonical_name = trim(canonical_name)
WHERE archived_at IS NULL;

UPDATE knowledge_nodes
SET is_unclassified = 1
WHERE node_type = 'chapter'
  AND archived_at IS NULL
  AND canonical_name = '待归类知识点' COLLATE NOCASE;

CREATE TEMP TABLE axiom_unclassified_textbooks (
  textbook_id TEXT PRIMARY KEY NOT NULL
);

-- Find active nodes with no active chapter ancestor.  The recursive walk is
-- scoped by textbook so a malformed legacy parent cannot cross textbooks.
WITH RECURSIVE lineage(node_id, cursor_id, textbook_id, depth) AS (
  SELECT id, id, textbook_id, 0
  FROM knowledge_nodes
  WHERE archived_at IS NULL
  UNION ALL
  SELECT lineage.node_id, parent.id, lineage.textbook_id, lineage.depth + 1
  FROM lineage
  JOIN knowledge_nodes current_node
    ON current_node.id = lineage.cursor_id
   AND current_node.textbook_id = lineage.textbook_id
  JOIN knowledge_nodes parent
    ON parent.id = current_node.parent_id
   AND parent.textbook_id = lineage.textbook_id
  WHERE current_node.parent_id IS NOT NULL AND lineage.depth < 100
)
INSERT OR IGNORE INTO axiom_unclassified_textbooks (textbook_id)
SELECT DISTINCT node.textbook_id
FROM knowledge_nodes node
WHERE node.archived_at IS NULL
  AND node.node_type != 'chapter'
  AND NOT EXISTS (
    SELECT 1
    FROM lineage
    JOIN knowledge_nodes ancestor
      ON ancestor.id = lineage.cursor_id
     AND ancestor.textbook_id = lineage.textbook_id
    WHERE lineage.node_id = node.id
      AND ancestor.node_type = 'chapter'
      AND ancestor.archived_at IS NULL
  );

-- Reuse an already named unclassified chapter where possible.  The
-- deterministic id makes retries idempotent for databases that have not got
-- one yet.
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
  '迁移时无法从目录或页码确定父章节的知识点。',
  NULL,
  NULL,
  '由教材结构兼容迁移创建。',
  textbook.source_path,
  'manual',
  0,
  'needs_review',
  1,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM axiom_unclassified_textbooks pending
JOIN textbooks textbook ON textbook.id = pending.textbook_id
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_nodes existing
  WHERE existing.textbook_id = textbook.id
    AND existing.node_type = 'chapter'
    AND existing.is_unclassified = 1
    AND existing.archived_at IS NULL
);

CREATE TEMP TABLE axiom_node_chapter (
  node_id TEXT PRIMARY KEY NOT NULL,
  chapter_id TEXT NOT NULL
);

WITH RECURSIVE lineage(node_id, cursor_id, textbook_id, depth) AS (
  SELECT id, id, textbook_id, 0
  FROM knowledge_nodes
  WHERE archived_at IS NULL
  UNION ALL
  SELECT lineage.node_id, parent.id, lineage.textbook_id, lineage.depth + 1
  FROM lineage
  JOIN knowledge_nodes current_node
    ON current_node.id = lineage.cursor_id
   AND current_node.textbook_id = lineage.textbook_id
  JOIN knowledge_nodes parent
    ON parent.id = current_node.parent_id
   AND parent.textbook_id = lineage.textbook_id
  WHERE current_node.parent_id IS NOT NULL AND lineage.depth < 100
)
INSERT INTO axiom_node_chapter (node_id, chapter_id)
SELECT node.id,
  COALESCE(
    (
      SELECT ancestor.id
      FROM lineage walk
      JOIN knowledge_nodes ancestor
        ON ancestor.id = walk.cursor_id
       AND ancestor.textbook_id = walk.textbook_id
      WHERE walk.node_id = node.id
        AND ancestor.node_type = 'chapter'
        AND ancestor.archived_at IS NULL
      ORDER BY walk.depth
      LIMIT 1
    ),
    (
      SELECT chapter.id
      FROM knowledge_nodes chapter
      WHERE chapter.textbook_id = node.textbook_id
        AND chapter.node_type = 'chapter'
        AND chapter.archived_at IS NULL
        AND (
          lower(node.path) LIKE lower(chapter.path) || '/%'
          OR (
            node.source_page_start IS NOT NULL
            AND chapter.source_page_start IS NOT NULL
            AND node.source_page_start >= chapter.source_page_start
            AND node.source_page_start <= COALESCE(chapter.source_page_end, 2147483647)
          )
        )
      ORDER BY CASE WHEN lower(node.path) LIKE lower(chapter.path) || '/%' THEN 0 ELSE 1 END,
        abs(COALESCE(node.source_page_start, chapter.source_page_start) - COALESCE(chapter.source_page_start, node.source_page_start))
      LIMIT 1
    ),
    (
      SELECT fallback.id
      FROM knowledge_nodes fallback
      WHERE fallback.textbook_id = node.textbook_id
        AND fallback.node_type = 'chapter'
        AND fallback.is_unclassified = 1
        AND fallback.archived_at IS NULL
      ORDER BY fallback.id
      LIMIT 1
    )
  )
FROM knowledge_nodes node
WHERE node.archived_at IS NULL;

-- Every non-chapter node is now a direct knowledge child of its nearest
-- chapter.  Levels 2 and 3 therefore become siblings, never a new tree layer.
UPDATE knowledge_nodes
SET node_type = CASE WHEN node_type = 'chapter' THEN 'chapter' ELSE 'knowledge' END,
    parent_id = CASE
      WHEN node_type = 'chapter' THEN NULL
      ELSE (SELECT chapter_id FROM axiom_node_chapter WHERE node_id = knowledge_nodes.id)
    END,
    is_unclassified = CASE WHEN node_type = 'chapter' THEN is_unclassified ELSE 0 END,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE archived_at IS NULL;

-- Merge normalized duplicate knowledge points within one chapter.  The oldest
-- user-confirmed row wins; otherwise creation order and id make the result
-- deterministic.  Only knowledge rows participate, so chapters are never
-- accidentally merged into their children.
CREATE TEMP TABLE axiom_node_merge (
  source_id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL
);

WITH names AS (
  SELECT node.id, node.textbook_id, node.parent_id, node.verification_status, node.created_at,
    lower(trim(
      replace(replace(replace(replace(replace(node.canonical_name, ' ', ''), char(12288), ''), '·', ''), '。', ''), '、', '')
    )) AS normalized_name
  FROM knowledge_nodes node
  WHERE node.node_type = 'knowledge' AND node.archived_at IS NULL
), ranked AS (
  SELECT names.*,
    first_value(names.id) OVER (
      PARTITION BY names.textbook_id, names.parent_id, names.normalized_name
      ORDER BY CASE WHEN names.verification_status = 'user_verified' THEN 0 ELSE 1 END,
        names.created_at, names.id
    ) AS target_id,
    row_number() OVER (
      PARTITION BY names.textbook_id, names.parent_id, names.normalized_name
      ORDER BY CASE WHEN names.verification_status = 'user_verified' THEN 0 ELSE 1 END,
        names.created_at, names.id
    ) AS duplicate_rank
  FROM names
)
INSERT INTO axiom_node_merge (source_id, target_id)
SELECT id, target_id FROM ranked WHERE duplicate_rank > 1;

UPDATE tag_definitions
SET knowledge_node_id = (
  SELECT target_id FROM axiom_node_merge WHERE source_id = tag_definitions.knowledge_node_id
)
WHERE knowledge_node_id IN (SELECT source_id FROM axiom_node_merge);

UPDATE tag_definition_revisions
SET knowledge_node_id = (
  SELECT target_id FROM axiom_node_merge WHERE source_id = tag_definition_revisions.knowledge_node_id
)
WHERE knowledge_node_id IN (SELECT source_id FROM axiom_node_merge);

INSERT OR IGNORE INTO curriculum_tag_knowledge_links (
  tag_id, knowledge_node_id, source, confidence, created_at
)
SELECT links.tag_id, merge.target_id, links.source, links.confidence, links.created_at
FROM curriculum_tag_knowledge_links links
JOIN axiom_node_merge merge ON merge.source_id = links.knowledge_node_id;

DELETE FROM curriculum_tag_knowledge_links
WHERE knowledge_node_id IN (SELECT source_id FROM axiom_node_merge);

-- Repoint edge endpoints before archiving duplicate rows.  Self edges created
-- by a merge are intentionally discarded because the schema forbids them.
INSERT OR IGNORE INTO knowledge_edges (
  id, subject, from_node_id, to_node_id, relation_type, confidence, source,
  verification_status, created_at, updated_at
)
SELECT
  'migration-edge-' || lower(hex(randomblob(16))),
  edge.subject,
  COALESCE(from_merge.target_id, edge.from_node_id),
  COALESCE(to_merge.target_id, edge.to_node_id),
  edge.relation_type,
  edge.confidence,
  edge.source,
  edge.verification_status,
  edge.created_at,
  edge.updated_at
FROM knowledge_edges edge
LEFT JOIN axiom_node_merge from_merge ON from_merge.source_id = edge.from_node_id
LEFT JOIN axiom_node_merge to_merge ON to_merge.source_id = edge.to_node_id
WHERE (from_merge.source_id IS NOT NULL OR to_merge.source_id IS NOT NULL)
  AND COALESCE(from_merge.target_id, edge.from_node_id) != COALESCE(to_merge.target_id, edge.to_node_id);

DELETE FROM knowledge_edges
WHERE from_node_id IN (SELECT source_id FROM axiom_node_merge)
   OR to_node_id IN (SELECT source_id FROM axiom_node_merge);

UPDATE knowledge_nodes
SET merged_into_id = (SELECT target_id FROM axiom_node_merge WHERE source_id = knowledge_nodes.id),
    archived_at = COALESCE(archived_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (SELECT source_id FROM axiom_node_merge);

-- Rebuild the two-level paths and deterministic sibling ordering.
UPDATE knowledge_nodes
SET path = canonical_name,
    parent_id = NULL
WHERE node_type = 'chapter' AND archived_at IS NULL;

UPDATE knowledge_nodes
SET path = (
  SELECT parent.path || '/' || knowledge_nodes.canonical_name
  FROM knowledge_nodes parent
  WHERE parent.id = knowledge_nodes.parent_id
    AND parent.node_type = 'chapter'
    AND parent.archived_at IS NULL
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
      ORDER BY COALESCE(node.source_page_start, 2147483000), node.sort_order, node.created_at, node.id
    ) - 1 AS next_sort_order
  FROM knowledge_nodes node
  WHERE node.archived_at IS NULL
)
INSERT INTO axiom_node_sort (node_id, sort_order)
SELECT id, next_sort_order FROM ordered;

UPDATE knowledge_nodes
SET sort_order = (SELECT sort_order FROM axiom_node_sort WHERE node_id = knowledge_nodes.id)
WHERE id IN (SELECT node_id FROM axiom_node_sort);

CREATE UNIQUE INDEX idx_knowledge_nodes_sibling_name
  ON knowledge_nodes(subject, textbook_id, ifnull(parent_id, ''), node_type, canonical_name COLLATE NOCASE)
  WHERE archived_at IS NULL AND merged_into_id IS NULL;

-- Keep the repaired shape true for future manual edits as well: roots are
-- chapters, and every child is a knowledge point directly under a chapter.
CREATE TRIGGER IF NOT EXISTS trg_knowledge_node_two_level_insert
BEFORE INSERT ON knowledge_nodes
WHEN (NEW.parent_id IS NULL AND NEW.node_type != 'chapter')
  OR (NEW.parent_id IS NOT NULL AND (
    NEW.node_type != 'knowledge' OR NOT EXISTS (
      SELECT 1 FROM knowledge_nodes parent
      WHERE parent.id = NEW.parent_id
        AND parent.subject = NEW.subject
        AND parent.textbook_id = NEW.textbook_id
        AND parent.node_type = 'chapter'
    )
  ))
BEGIN
  SELECT RAISE(ABORT, 'curriculum nodes must use chapter -> knowledge structure');
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_node_two_level_update
BEFORE UPDATE OF parent_id, node_type, subject, textbook_id ON knowledge_nodes
WHEN (NEW.parent_id IS NULL AND NEW.node_type != 'chapter')
  OR (NEW.parent_id IS NOT NULL AND (
    NEW.node_type != 'knowledge' OR NOT EXISTS (
      SELECT 1 FROM knowledge_nodes parent
      WHERE parent.id = NEW.parent_id
        AND parent.subject = NEW.subject
        AND parent.textbook_id = NEW.textbook_id
        AND parent.node_type = 'chapter'
    )
  ))
BEGIN
  SELECT RAISE(ABORT, 'curriculum nodes must use chapter -> knowledge structure');
END;

-- The relabel start action is also safe across two windows.  Preserve the
-- newest active batch for a subject and cancel older concurrent leftovers
-- before adding the durable one-active-batch invariant.
UPDATE tag_relabel_batches AS older
SET status = 'cancelled',
    error_message = COALESCE(error_message, '已由并发批次兼容迁移取消'),
    completed_at = COALESCE(completed_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE older.status IN ('pending', 'processing')
  AND EXISTS (
    SELECT 1 FROM tag_relabel_batches newer
    WHERE newer.subject = older.subject
      AND newer.status IN ('pending', 'processing')
      AND (newer.updated_at > older.updated_at
        OR (newer.updated_at = older.updated_at AND newer.id > older.id))
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_relabel_one_active_subject
  ON tag_relabel_batches(subject)
  WHERE status IN ('pending', 'processing');

DROP TABLE axiom_node_sort;
DROP TABLE axiom_node_merge;
DROP TABLE axiom_node_chapter;
DROP TABLE axiom_unclassified_textbooks;

COMMIT;
