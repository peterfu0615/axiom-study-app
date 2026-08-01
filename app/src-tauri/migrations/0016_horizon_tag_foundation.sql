-- Axiom 0.4.0 Horizon Tag Foundation.
--
-- This migration is intentionally additive. Legacy free-form knowledge JSON and
-- review tables remain untouched so existing problems and ModelRun history stay
-- readable while controlled, subject-scoped data is introduced alongside them.

CREATE TABLE IF NOT EXISTS taxonomy_versions (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'retired')),
  note TEXT,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  UNIQUE(subject, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomy_one_published_subject
  ON taxonomy_versions(subject)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS textbooks (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  grade TEXT,
  volume TEXT,
  publisher TEXT,
  edition TEXT,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('pdf', 'scanned_pdf', 'directory_image', 'manual')
  ),
  source_path TEXT,
  content_hash TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    extraction_status IN ('pending', 'processing', 'needs_review', 'completed', 'failed')
  ),
  extraction_method TEXT CHECK (
    extraction_method IS NULL OR
    extraction_method IN ('pdf_text', 'vision_ocr', 'manual', 'mixed')
  ),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(id, subject)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_textbooks_current_subject
  ON textbooks(subject)
  WHERE is_current = 1 AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_textbooks_subject
  ON textbooks(subject, archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS textbook_pages (
  id TEXT PRIMARY KEY NOT NULL,
  textbook_id TEXT NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  evidence_text TEXT NOT NULL DEFAULT '',
  source_path TEXT,
  extraction_method TEXT NOT NULL CHECK (
    extraction_method IN ('pdf_text', 'vision_ocr', 'manual')
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

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  textbook_id TEXT NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  canonical_name TEXT NOT NULL CHECK (length(trim(canonical_name)) > 0),
  node_type TEXT NOT NULL CHECK (
    node_type IN ('book', 'chapter', 'section', 'knowledge', 'definition', 'formula', 'theorem', 'property')
  ),
  parent_id TEXT,
  path TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  curriculum_version INTEGER NOT NULL DEFAULT 1 CHECK (curriculum_version > 0),
  description TEXT,
  source_page_start INTEGER,
  source_page_end INTEGER,
  evidence_text TEXT,
  source_path TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'manual' CHECK (
    extraction_method IN ('pdf_text', 'vision_ocr', 'manual', 'mixed')
  ),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'ai_verified', 'user_verified', 'needs_review', 'rejected')
  ),
  merged_into_id TEXT,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(textbook_id, subject) REFERENCES textbooks(id, subject),
  FOREIGN KEY(parent_id) REFERENCES knowledge_nodes(id),
  FOREIGN KEY(merged_into_id) REFERENCES knowledge_nodes(id),
  UNIQUE(id, subject, textbook_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_tree
  ON knowledge_nodes(subject, textbook_id, parent_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_nodes_sibling_name
  ON knowledge_nodes(subject, textbook_id, ifnull(parent_id, ''), node_type, canonical_name COLLATE NOCASE)
  WHERE archived_at IS NULL AND merged_into_id IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_node_parent_subject_insert
BEFORE INSERT ON knowledge_nodes
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM knowledge_nodes parent
  WHERE parent.id = NEW.parent_id
    AND parent.subject = NEW.subject
    AND parent.textbook_id = NEW.textbook_id
)
BEGIN
  SELECT RAISE(ABORT, 'knowledge node parent must belong to the same subject and textbook');
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_node_parent_subject_update
BEFORE UPDATE OF parent_id, subject, textbook_id ON knowledge_nodes
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM knowledge_nodes parent
  WHERE parent.id = NEW.parent_id
    AND parent.subject = NEW.subject
    AND parent.textbook_id = NEW.textbook_id
)
BEGIN
  SELECT RAISE(ABORT, 'knowledge node parent must belong to the same subject and textbook');
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_node_merge_subject
BEFORE UPDATE OF merged_into_id ON knowledge_nodes
WHEN NEW.merged_into_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM knowledge_nodes target
  WHERE target.id = NEW.merged_into_id
    AND target.subject = NEW.subject
    AND target.textbook_id = NEW.textbook_id
    AND target.id != NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'knowledge nodes can only merge within one subject and textbook');
END;

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  from_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
  to_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
  relation_type TEXT NOT NULL CHECK (
    relation_type IN ('contains', 'prerequisite_of', 'derived_from', 'similar_to', 'confusable_with', 'used_by', 'appears_in')
  ),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  source TEXT NOT NULL DEFAULT 'user' CHECK (
    source IN ('textbook', 'model', 'user', 'system')
  ),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'ai_verified', 'user_verified', 'needs_review', 'rejected')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(subject, from_node_id, to_node_id, relation_type),
  CHECK(from_node_id != to_node_id)
);

CREATE TRIGGER IF NOT EXISTS trg_knowledge_edge_subject_insert
BEFORE INSERT ON knowledge_edges
WHEN NOT EXISTS (
  SELECT 1
  FROM knowledge_nodes source, knowledge_nodes target
  WHERE source.id = NEW.from_node_id
    AND target.id = NEW.to_node_id
    AND source.subject = NEW.subject
    AND target.subject = NEW.subject
)
BEGIN
  SELECT RAISE(ABORT, 'knowledge edge endpoints must belong to its subject');
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_edge_subject_update
BEFORE UPDATE OF subject, from_node_id, to_node_id ON knowledge_edges
WHEN NOT EXISTS (
  SELECT 1
  FROM knowledge_nodes source, knowledge_nodes target
  WHERE source.id = NEW.from_node_id
    AND target.id = NEW.to_node_id
    AND source.subject = NEW.subject
    AND target.subject = NEW.subject
)
BEGIN
  SELECT RAISE(ABORT, 'knowledge edge endpoints must belong to its subject');
END;

CREATE TABLE IF NOT EXISTS tag_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  tag_type TEXT NOT NULL CHECK (tag_type IN ('knowledge', 'method', 'model', 'error')),
  canonical_name TEXT NOT NULL CHECK (length(trim(canonical_name)) > 0),
  description TEXT,
  parent_id TEXT REFERENCES tag_definitions(id),
  knowledge_node_id TEXT REFERENCES knowledge_nodes(id),
  source TEXT NOT NULL DEFAULT 'user' CHECK (
    source IN ('textbook', 'model', 'user', 'template', 'legacy')
  ),
  taxonomy_version INTEGER NOT NULL DEFAULT 1 CHECK (taxonomy_version > 0),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'ai_verified', 'user_verified', 'needs_review', 'rejected')
  ),
  lifecycle_status TEXT NOT NULL DEFAULT 'candidate' CHECK (
    lifecycle_status IN ('candidate', 'active', 'rejected', 'archived', 'merged')
  ),
  method_class TEXT CHECK (
    method_class IS NULL OR method_class IN ('core', 'optional')
  ),
  merged_into_id TEXT REFERENCES tag_definitions(id),
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(id, subject),
  UNIQUE(subject, tag_type, canonical_name COLLATE NOCASE)
);

CREATE INDEX IF NOT EXISTS idx_tag_definitions_subject_type
  ON tag_definitions(subject, tag_type, lifecycle_status, canonical_name);

CREATE TABLE IF NOT EXISTS tag_definition_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tag_definitions(id),
  subject TEXT NOT NULL,
  tag_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  description TEXT,
  parent_id TEXT,
  knowledge_node_id TEXT,
  taxonomy_version INTEGER NOT NULL,
  verification_status TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  method_class TEXT,
  merged_into_id TEXT,
  archived_at INTEGER,
  recorded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tag_definition_revisions_history
  ON tag_definition_revisions(subject, tag_id, recorded_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_tag_definition_revision
BEFORE UPDATE ON tag_definitions
WHEN OLD.canonical_name != NEW.canonical_name
  OR ifnull(OLD.description, '') != ifnull(NEW.description, '')
  OR ifnull(OLD.parent_id, '') != ifnull(NEW.parent_id, '')
  OR ifnull(OLD.knowledge_node_id, '') != ifnull(NEW.knowledge_node_id, '')
  OR OLD.taxonomy_version != NEW.taxonomy_version
  OR OLD.verification_status != NEW.verification_status
  OR OLD.lifecycle_status != NEW.lifecycle_status
  OR ifnull(OLD.method_class, '') != ifnull(NEW.method_class, '')
  OR ifnull(OLD.merged_into_id, '') != ifnull(NEW.merged_into_id, '')
  OR ifnull(OLD.archived_at, -1) != ifnull(NEW.archived_at, -1)
BEGIN
  INSERT INTO tag_definition_revisions (
    id, tag_id, subject, tag_type, canonical_name, description, parent_id,
    knowledge_node_id, taxonomy_version, verification_status, lifecycle_status,
    method_class, merged_into_id, archived_at, recorded_at
  ) VALUES (
    lower(hex(randomblob(16))), OLD.id, OLD.subject, OLD.tag_type,
    OLD.canonical_name, OLD.description, OLD.parent_id, OLD.knowledge_node_id,
    OLD.taxonomy_version, OLD.verification_status, OLD.lifecycle_status,
    OLD.method_class, OLD.merged_into_id, OLD.archived_at,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_tag_definition_links_insert
BEFORE INSERT ON tag_definitions
WHEN (NEW.parent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM tag_definitions parent
  WHERE parent.id = NEW.parent_id AND parent.subject = NEW.subject
)) OR (NEW.knowledge_node_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM knowledge_nodes node
  WHERE node.id = NEW.knowledge_node_id AND node.subject = NEW.subject
))
BEGIN
  SELECT RAISE(ABORT, 'tag definition links must stay within one subject');
END;

CREATE TRIGGER IF NOT EXISTS trg_tag_definition_links_update
BEFORE UPDATE OF subject, parent_id, knowledge_node_id, merged_into_id ON tag_definitions
WHEN (NEW.parent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM tag_definitions parent
  WHERE parent.id = NEW.parent_id AND parent.subject = NEW.subject
)) OR (NEW.knowledge_node_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM knowledge_nodes node
  WHERE node.id = NEW.knowledge_node_id AND node.subject = NEW.subject
)) OR (NEW.merged_into_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM tag_definitions target
  WHERE target.id = NEW.merged_into_id
    AND target.subject = NEW.subject
    AND target.tag_type = NEW.tag_type
    AND target.id != NEW.id
))
BEGIN
  SELECT RAISE(ABORT, 'tag definition links and merges must stay within one subject and type');
END;

CREATE TABLE IF NOT EXISTS tag_aliases (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tag_definitions(id),
  alias TEXT NOT NULL CHECK (length(trim(alias)) > 0),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('model', 'user', 'template', 'merge')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(tag_id, subject) REFERENCES tag_definitions(id, subject),
  UNIQUE(subject, tag_id, alias COLLATE NOCASE)
);

CREATE INDEX IF NOT EXISTS idx_tag_alias_lookup
  ON tag_aliases(subject, alias COLLATE NOCASE);

CREATE TRIGGER IF NOT EXISTS trg_tag_alias_unambiguous_insert
BEFORE INSERT ON tag_aliases
WHEN EXISTS (
  SELECT 1
  FROM tag_aliases existing
  JOIN tag_definitions existing_tag ON existing_tag.id = existing.tag_id
  JOIN tag_definitions new_tag ON new_tag.id = NEW.tag_id
  WHERE existing.subject = NEW.subject
    AND existing.alias = NEW.alias COLLATE NOCASE
    AND existing.tag_id != NEW.tag_id
    AND existing_tag.tag_type = new_tag.tag_type
)
BEGIN
  SELECT RAISE(ABORT, 'a subject-scoped alias cannot resolve to multiple tags of one type');
END;

CREATE TABLE IF NOT EXISTS problem_tags (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  tag_type TEXT NOT NULL CHECK (tag_type IN ('knowledge', 'method', 'model', 'error')),
  tag_id TEXT REFERENCES tag_definitions(id),
  candidate_name TEXT,
  role TEXT NOT NULL DEFAULT 'secondary' CHECK (role IN ('primary', 'secondary')),
  mapping_status TEXT NOT NULL CHECK (
    mapping_status IN ('mapped', 'unmapped', 'candidate', 'rejected')
  ),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  evidence TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'model' CHECK (
    source IN ('textbook', 'model', 'user', 'legacy')
  ),
  taxonomy_version INTEGER NOT NULL DEFAULT 1 CHECK (taxonomy_version > 0),
  model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'ai_verified', 'user_verified', 'needs_review', 'rejected')
  ),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  superseded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (mapping_status = 'mapped' AND tag_id IS NOT NULL) OR
    (mapping_status != 'mapped' AND tag_id IS NULL AND length(trim(candidate_name)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_problem_tag_active_definition
  ON problem_tags(problem_id, tag_type, tag_id)
  WHERE superseded_at IS NULL AND tag_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_problem_tags_review
  ON problem_tags(subject, mapping_status, verification_status, updated_at DESC)
  WHERE superseded_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_problem_tag_subject_insert
BEFORE INSERT ON problem_tags
WHEN NOT EXISTS (
  SELECT 1 FROM problems problem
  WHERE problem.id = NEW.problem_id
    AND lower(trim(COALESCE(
      NULLIF(problem.user_subject, ''),
      NULLIF(problem.ai_subject, ''),
      NULLIF(problem.subject, '')
    ))) = lower(trim(NEW.subject))
) OR (NEW.tag_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM tag_definitions tag
  WHERE tag.id = NEW.tag_id
    AND tag.subject = NEW.subject
    AND tag.tag_type = NEW.tag_type
)) OR (NEW.model_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM model_runs run
  WHERE run.id = NEW.model_run_id AND run.problem_id = NEW.problem_id
))
BEGIN
  SELECT RAISE(ABORT, 'problem, tag, ModelRun and ProblemTag subjects must match');
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_tag_subject_update
BEFORE UPDATE OF problem_id, subject, tag_type, tag_id, model_run_id ON problem_tags
WHEN NOT EXISTS (
  SELECT 1 FROM problems problem
  WHERE problem.id = NEW.problem_id
    AND lower(trim(COALESCE(
      NULLIF(problem.user_subject, ''),
      NULLIF(problem.ai_subject, ''),
      NULLIF(problem.subject, '')
    ))) = lower(trim(NEW.subject))
) OR (NEW.tag_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM tag_definitions tag
  WHERE tag.id = NEW.tag_id
    AND tag.subject = NEW.subject
    AND tag.tag_type = NEW.tag_type
)) OR (NEW.model_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM model_runs run
  WHERE run.id = NEW.model_run_id AND run.problem_id = NEW.problem_id
))
BEGIN
  SELECT RAISE(ABORT, 'problem, tag, ModelRun and ProblemTag subjects must match');
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_subject_preserves_tags
BEFORE UPDATE OF subject, ai_subject, user_subject ON problems
WHEN EXISTS (
  SELECT 1 FROM problem_tags tag
  WHERE tag.problem_id = NEW.id
    AND tag.superseded_at IS NULL
    AND lower(trim(tag.subject)) != lower(trim(COALESCE(
      NULLIF(NEW.user_subject, ''),
      NULLIF(NEW.ai_subject, ''),
      NULLIF(NEW.subject, '')
    )))
)
BEGIN
  SELECT RAISE(ABORT, 'problem subject cannot change while subject-scoped tags are active');
END;

CREATE TABLE IF NOT EXISTS problem_difficulties (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('basic', 'intermediate', 'advanced')),
  score REAL CHECK (score IS NULL OR score BETWEEN 0 AND 1),
  reason TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  context_grade TEXT,
  source TEXT NOT NULL DEFAULT 'model' CHECK (source IN ('model', 'user', 'legacy')),
  model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'ai_verified', 'user_verified', 'needs_review', 'rejected')
  ),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  superseded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_problem_difficulty_active
  ON problem_difficulties(problem_id)
  WHERE superseded_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_problem_difficulty_subject_insert
BEFORE INSERT ON problem_difficulties
WHEN NOT EXISTS (
  SELECT 1 FROM problems problem
  WHERE problem.id = NEW.problem_id
    AND lower(trim(COALESCE(
      NULLIF(problem.user_subject, ''),
      NULLIF(problem.ai_subject, ''),
      NULLIF(problem.subject, '')
    ))) = lower(trim(NEW.subject))
) OR (NEW.model_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM model_runs run
  WHERE run.id = NEW.model_run_id AND run.problem_id = NEW.problem_id
))
BEGIN
  SELECT RAISE(ABORT, 'problem difficulty subject and ModelRun must match its problem');
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_difficulty_subject_update
BEFORE UPDATE OF problem_id, subject, model_run_id ON problem_difficulties
WHEN NOT EXISTS (
  SELECT 1 FROM problems problem
  WHERE problem.id = NEW.problem_id
    AND lower(trim(COALESCE(
      NULLIF(problem.user_subject, ''),
      NULLIF(problem.ai_subject, ''),
      NULLIF(problem.subject, '')
    ))) = lower(trim(NEW.subject))
) OR (NEW.model_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM model_runs run
  WHERE run.id = NEW.model_run_id AND run.problem_id = NEW.problem_id
))
BEGIN
  SELECT RAISE(ABORT, 'problem difficulty subject and ModelRun must match its problem');
END;

CREATE TABLE IF NOT EXISTS skill_states (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tag_definitions(id),
  mastery_estimate REAL NOT NULL DEFAULT 0.5 CHECK (mastery_estimate BETWEEN 0 AND 1),
  stability REAL NOT NULL DEFAULT 0 CHECK (stability >= 0),
  retrievability REAL NOT NULL DEFAULT 0.5 CHECK (retrievability BETWEEN 0 AND 1),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  transfer_score REAL NOT NULL DEFAULT 0 CHECK (transfer_score BETWEEN 0 AND 1),
  max_stable_difficulty TEXT CHECK (
    max_stable_difficulty IS NULL OR
    max_stable_difficulty IN ('basic', 'intermediate', 'advanced')
  ),
  last_practiced_at INTEGER,
  next_review_at INTEGER,
  uncertainty REAL NOT NULL DEFAULT 1 CHECK (uncertainty BETWEEN 0 AND 1),
  scheduler_version TEXT NOT NULL DEFAULT 'foundation-v1',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(tag_id, subject) REFERENCES tag_definitions(id, subject),
  UNIQUE(subject, tag_id)
);

CREATE TRIGGER IF NOT EXISTS trg_skill_state_tag_type_insert
BEFORE INSERT ON skill_states
WHEN NOT EXISTS (
  SELECT 1 FROM tag_definitions tag
  WHERE tag.id = NEW.tag_id
    AND tag.subject = NEW.subject
    AND tag.tag_type IN ('knowledge', 'method', 'model')
)
BEGIN
  SELECT RAISE(ABORT, 'SkillState requires a knowledge, method, or model tag in the same subject');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_state_tag_type_update
BEFORE UPDATE OF subject, tag_id ON skill_states
WHEN NOT EXISTS (
  SELECT 1 FROM tag_definitions tag
  WHERE tag.id = NEW.tag_id
    AND tag.subject = NEW.subject
    AND tag.tag_type IN ('knowledge', 'method', 'model')
)
BEGIN
  SELECT RAISE(ABORT, 'SkillState requires a knowledge, method, or model tag in the same subject');
END;

CREATE TABLE IF NOT EXISTS tag_relabel_batches (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'completed', 'cancelled', 'failed')
  ),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS tag_relabel_items (
  batch_id TEXT NOT NULL REFERENCES tag_relabel_batches(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'queued', 'processing', 'completed', 'cancelled', 'failed')
  ),
  model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(batch_id, problem_id)
);

CREATE TRIGGER IF NOT EXISTS trg_relabel_item_subject_insert
BEFORE INSERT ON tag_relabel_items
WHEN NOT EXISTS (
  SELECT 1
  FROM tag_relabel_batches batch, problems problem
  WHERE batch.id = NEW.batch_id
    AND batch.subject = NEW.subject
    AND problem.id = NEW.problem_id
    AND lower(trim(COALESCE(
      NULLIF(problem.user_subject, ''),
      NULLIF(problem.ai_subject, ''),
      NULLIF(problem.subject, '')
    ))) = lower(trim(NEW.subject))
)
BEGIN
  SELECT RAISE(ABORT, 'relabel batch and problem subjects must match');
END;

-- Existing normalized user knowledge references are copied as controlled tags.
-- Free-form AI JSON remains legacy input and is deliberately not promoted to
-- formal tags without the candidate review flow.
INSERT OR IGNORE INTO tag_definitions (
  id, subject, tag_type, canonical_name, description, parent_id,
  knowledge_node_id, source, taxonomy_version, verification_status,
  lifecycle_status, method_class, merged_into_id, archived_at,
  created_at, updated_at
)
SELECT
  'legacy-kp-' || kp.id,
  kp.subject,
  'knowledge',
  kp.canonical_name,
  NULL,
  NULL,
  NULL,
  'legacy',
  1,
  CASE WHEN EXISTS (
    SELECT 1 FROM problem_knowledge_points pkp
    WHERE pkp.knowledge_point_id = kp.id AND pkp.source = 'user'
  ) THEN 'user_verified' ELSE 'needs_review' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM problem_knowledge_points pkp
    WHERE pkp.knowledge_point_id = kp.id AND pkp.source = 'user'
  ) THEN 'active' ELSE 'candidate' END,
  NULL,
  NULL,
  NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM knowledge_points kp
WHERE length(trim(kp.subject)) > 0;

INSERT OR IGNORE INTO problem_tags (
  id, problem_id, subject, tag_type, tag_id, candidate_name, role,
  mapping_status, confidence, evidence, source, taxonomy_version,
  model_run_id, verification_status, is_locked, superseded_at,
  created_at, updated_at
)
SELECT
  'legacy-pkp-' || pkp.problem_id || '-' || pkp.knowledge_point_id,
  pkp.problem_id,
  kp.subject,
  'knowledge',
  'legacy-kp-' || kp.id,
  NULL,
  'secondary',
  'mapped',
  COALESCE(pkp.confidence, 0),
  'Migrated from problem_knowledge_points',
  'legacy',
  1,
  NULL,
  CASE WHEN pkp.source = 'user' THEN 'user_verified' ELSE 'needs_review' END,
  CASE WHEN pkp.source = 'user' THEN 1 ELSE 0 END,
  NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM problem_knowledge_points pkp
JOIN knowledge_points kp ON kp.id = pkp.knowledge_point_id
JOIN problems problem ON problem.id = pkp.problem_id
WHERE lower(trim(COALESCE(
  NULLIF(problem.user_subject, ''),
  NULLIF(problem.ai_subject, ''),
  NULLIF(problem.subject, '')
))) = lower(trim(kp.subject));
