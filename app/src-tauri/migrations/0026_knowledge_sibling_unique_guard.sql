-- Re-establish database-level sibling dedupe for knowledge nodes.
--
-- Migration 0024 flattened the curriculum tree and rebuilt the sibling unique
-- index, but same-level duplicates can still slip in through re-imports and
-- legacy data because the JS layer alone (normalizeTagName) is not enforced
-- by the database.  This migration soft-archives existing duplicates within
-- one parent (the earliest created row wins; rows are never deleted so the
-- change stays recoverable), repoints references to the surviving row the
-- same way migration 0024 did for merges, and finally installs a strict
-- partial unique index so future writes cannot reintroduce duplicates.
--
-- The migration is idempotent: a replay finds no duplicate groups, performs
-- no updates, and CREATE INDEX IF NOT EXISTS keeps the guard in place.

BEGIN IMMEDIATE;

-- 1) Choose one keeper per group of active sibling duplicates.  The oldest
--    row wins; id breaks exact creation-time ties deterministically.
CREATE TEMP TABLE IF NOT EXISTS axiom_sibling_keeper (
  textbook_id TEXT NOT NULL,
  parent_key TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  keeper_id TEXT NOT NULL,
  PRIMARY KEY (textbook_id, parent_key, normalized_name)
);

INSERT OR IGNORE INTO axiom_sibling_keeper (textbook_id, parent_key, normalized_name, keeper_id)
SELECT node.textbook_id,
       ifnull(node.parent_id, ''),
       lower(trim(node.canonical_name)),
       (
         SELECT keeper.id
         FROM knowledge_nodes keeper
         WHERE keeper.textbook_id = node.textbook_id
           AND keeper.archived_at IS NULL
           AND ifnull(keeper.parent_id, '') = ifnull(node.parent_id, '')
           AND lower(trim(keeper.canonical_name)) = lower(trim(node.canonical_name))
         ORDER BY keeper.created_at, keeper.id
         LIMIT 1
       )
FROM knowledge_nodes node
WHERE node.archived_at IS NULL
GROUP BY node.textbook_id, ifnull(node.parent_id, ''), lower(trim(node.canonical_name))
HAVING count(*) > 1;

CREATE TEMP TABLE IF NOT EXISTS axiom_sibling_duplicate (
  source_id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL
);

INSERT OR IGNORE INTO axiom_sibling_duplicate (source_id, target_id)
SELECT node.id, keeper.keeper_id
FROM knowledge_nodes node
JOIN axiom_sibling_keeper keeper
  ON keeper.textbook_id = node.textbook_id
 AND keeper.parent_key = ifnull(node.parent_id, '')
 AND keeper.normalized_name = lower(trim(node.canonical_name))
WHERE node.archived_at IS NULL
  AND node.id != keeper.keeper_id;

-- 2) Repoint references to the keeper before archiving duplicates, so tags
--    and edges keep resolving (mirrors the merge handling in migration 0024).
UPDATE tag_definitions
SET knowledge_node_id = (
  SELECT target_id FROM axiom_sibling_duplicate WHERE source_id = tag_definitions.knowledge_node_id
)
WHERE knowledge_node_id IN (SELECT source_id FROM axiom_sibling_duplicate);

UPDATE tag_definition_revisions
SET knowledge_node_id = (
  SELECT target_id FROM axiom_sibling_duplicate WHERE source_id = tag_definition_revisions.knowledge_node_id
)
WHERE knowledge_node_id IN (SELECT source_id FROM axiom_sibling_duplicate);

INSERT OR IGNORE INTO curriculum_tag_knowledge_links (
  tag_id, knowledge_node_id, source, confidence, created_at
)
SELECT links.tag_id, dup.target_id, links.source, links.confidence, links.created_at
FROM curriculum_tag_knowledge_links links
JOIN axiom_sibling_duplicate dup ON dup.source_id = links.knowledge_node_id;

DELETE FROM curriculum_tag_knowledge_links
WHERE knowledge_node_id IN (SELECT source_id FROM axiom_sibling_duplicate);

-- Repoint edge endpoints.  Repointed copies collide with the edge uniqueness
-- constraint or become self edges, so insert surviving copies first and drop
-- every edge still attached to a duplicate row afterwards.
INSERT OR IGNORE INTO knowledge_edges (
  id, subject, from_node_id, to_node_id, relation_type, confidence, source,
  verification_status, created_at, updated_at
)
SELECT
  'migration-edge-' || lower(hex(randomblob(16))),
  edge.subject,
  COALESCE(from_dup.target_id, edge.from_node_id),
  COALESCE(to_dup.target_id, edge.to_node_id),
  edge.relation_type,
  edge.confidence,
  edge.source,
  edge.verification_status,
  edge.created_at,
  edge.updated_at
FROM knowledge_edges edge
LEFT JOIN axiom_sibling_duplicate from_dup ON from_dup.source_id = edge.from_node_id
LEFT JOIN axiom_sibling_duplicate to_dup ON to_dup.source_id = edge.to_node_id
WHERE (from_dup.source_id IS NOT NULL OR to_dup.source_id IS NOT NULL)
  AND COALESCE(from_dup.target_id, edge.from_node_id) != COALESCE(to_dup.target_id, edge.to_node_id);

DELETE FROM knowledge_edges
WHERE from_node_id IN (SELECT source_id FROM axiom_sibling_duplicate)
   OR to_node_id IN (SELECT source_id FROM axiom_sibling_duplicate);

-- 3) Soft-archive the duplicates.  merged_into_id records the survivor so the
--    archival stays consistent with the merge model used elsewhere.
UPDATE knowledge_nodes
SET merged_into_id = (SELECT target_id FROM axiom_sibling_duplicate WHERE source_id = knowledge_nodes.id),
    archived_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (SELECT source_id FROM axiom_sibling_duplicate);

-- 4) Database-level guard: at most one active node per parent and normalized
--    name.  trimmed + lower() matches the JS normalizeTagName contract closer
--    than the legacy COLLATE NOCASE index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_nodes_sibling_name_v2
  ON knowledge_nodes(textbook_id, ifnull(parent_id, ''), lower(trim(canonical_name)))
  WHERE archived_at IS NULL AND merged_into_id IS NULL;

DROP TABLE axiom_sibling_duplicate;
DROP TABLE axiom_sibling_keeper;

COMMIT;
