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
--
-- No explicit BEGIN/COMMIT here: the embedded migration runner
-- (db::migrate_embedded_schema) already wraps every migration in its own
-- BEGIN IMMEDIATE transaction, and a nested BEGIN IMMEDIATE fails with
-- "cannot start a transaction within a transaction".

-- 0) Drop the older sibling index from migration 0024 up front: it compares
--    un-trimmed names, so it would reject the mid-migration reparenting of
--    children from an archived duplicate to the keeper.  The v2 index created
--    at the end supersedes it and is strictly tighter (trim + lower()).
DROP INDEX IF EXISTS idx_knowledge_nodes_sibling_name;

-- 1) Choose one keeper per group of active sibling duplicates.  The oldest
--    row wins; id breaks exact creation-time ties deterministically.  The
--    window formulation avoids correlated scalar subqueries, which the
--    bundled SQLite engine resolves less reliably inside migrations.
CREATE TEMP TABLE IF NOT EXISTS axiom_sibling_duplicate (
  source_id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL
);

WITH ranked AS (
  SELECT node.id,
    first_value(node.id) OVER (
      PARTITION BY node.textbook_id, ifnull(node.parent_id, ''), lower(trim(node.canonical_name))
      ORDER BY node.created_at, node.id
    ) AS keeper_id,
    count(*) OVER (
      PARTITION BY node.textbook_id, ifnull(node.parent_id, ''), lower(trim(node.canonical_name))
    ) AS sibling_count
  FROM knowledge_nodes node
  WHERE node.archived_at IS NULL
)
INSERT INTO axiom_sibling_duplicate (source_id, target_id)
SELECT id, keeper_id
FROM ranked
WHERE sibling_count > 1 AND id != keeper_id;

-- 1b) Children hanging off an archived duplicate will be repointed to the
--     keeper in step 3.  If a same-named active child already lives under
--     the keeper, the repoint would violate the new unique index, so fold
--     that collision into the same duplicate map first (oldest wins again).
--     The curriculum tree is two levels deep (chapters → knowledge points),
--     so one collision pass covers every reachable child.
WITH projected AS (
  -- Children that step 3 will repoint: their effective parent becomes the
  -- keeper of their archived duplicate parent.
  SELECT child.id AS id,
    child.textbook_id AS textbook_id,
    dup.target_id AS parent_key,
    lower(trim(child.canonical_name)) AS normalized_name,
    child.created_at AS created_at
  FROM knowledge_nodes child
  JOIN axiom_sibling_duplicate dup ON dup.source_id = child.parent_id
  WHERE child.archived_at IS NULL
  UNION ALL
  -- Existing active children under those keeper parents: potential rivals.
  SELECT rival.id,
    rival.textbook_id,
    ifnull(rival.parent_id, ''),
    lower(trim(rival.canonical_name)),
    rival.created_at
  FROM knowledge_nodes rival
  WHERE rival.archived_at IS NULL
    AND ifnull(rival.parent_id, '') IN (SELECT target_id FROM axiom_sibling_duplicate)
),
ranked AS (
  SELECT projected.id,
    first_value(projected.id) OVER (
      PARTITION BY projected.textbook_id, projected.parent_key, projected.normalized_name
      ORDER BY projected.created_at, projected.id
    ) AS group_keeper_id
  FROM projected
)
INSERT OR IGNORE INTO axiom_sibling_duplicate (source_id, target_id)
SELECT ranked.id, ranked.group_keeper_id
FROM ranked
WHERE ranked.id != ranked.group_keeper_id;

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

-- 3) Repoint still-active children of duplicated chapters to the keeper so
--    no live node is left dangling under an archived parent.  Children whose
--    name collides with an existing keeper child were folded into the
--    duplicate map in step 1b and get archived in the next step.  This must
--    run BEFORE archiving the duplicates themselves: migration 0026 installs
--    trg_knowledge_node_archive_chapter_with_children, which aborts any
--    attempt to archive a chapter that still has active knowledge points.
UPDATE knowledge_nodes
SET parent_id = (SELECT target_id FROM axiom_sibling_duplicate WHERE source_id = knowledge_nodes.parent_id),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE parent_id IN (SELECT source_id FROM axiom_sibling_duplicate)
  AND archived_at IS NULL;

-- 4) Soft-archive the duplicates now that their children have been moved.
--    merged_into_id records the survivor so the archival stays consistent
--    with the merge model used elsewhere.  The transient same-named siblings
--    created by step 3 are safe: the sibling unique index only comes into
--    existence in step 5, after every duplicate has been archived.
UPDATE knowledge_nodes
SET merged_into_id = (SELECT target_id FROM axiom_sibling_duplicate WHERE source_id = knowledge_nodes.id),
    archived_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (SELECT source_id FROM axiom_sibling_duplicate);

-- 5) Database-level guard: at most one active node per parent and normalized
--    name.  trimmed + lower() only covers leading/trailing whitespace and
--    ASCII case folding; full normalization (NFKC, punctuation stripping,
--    locale-aware case) stays the responsibility of the JS write path
--    (normalizeTagName).  This index is the last line of defense, not the
--    complete dedupe contract.
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_nodes_sibling_name_v2
  ON knowledge_nodes(textbook_id, ifnull(parent_id, ''), lower(trim(canonical_name)))
  WHERE archived_at IS NULL AND merged_into_id IS NULL;

DROP TABLE axiom_sibling_duplicate;
