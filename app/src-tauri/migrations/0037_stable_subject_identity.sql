-- Introduce a stable Subject identity for the Horizon/ProblemTag pipeline.
-- `name` remains as a legacy compatibility key while new read paths use `id`.

ALTER TABLE subjects ADD COLUMN id TEXT;
ALTER TABLE subjects ADD COLUMN code TEXT;
ALTER TABLE subjects ADD COLUMN display_name TEXT;

UPDATE subjects
SET id = 'subject-' || lower(hex(randomblob(16))),
    display_name = name
WHERE id IS NULL;

UPDATE subjects
SET code = 'axiom-' || substr(id, 9, 12)
WHERE code IS NULL;

CREATE UNIQUE INDEX idx_subjects_id ON subjects(id);
CREATE UNIQUE INDEX idx_subjects_code ON subjects(code);
CREATE INDEX idx_subjects_display_name ON subjects(display_name COLLATE NOCASE);

ALTER TABLE textbooks ADD COLUMN subject_id TEXT;
ALTER TABLE knowledge_nodes ADD COLUMN subject_id TEXT;
ALTER TABLE knowledge_edges ADD COLUMN subject_id TEXT;
ALTER TABLE tag_definitions ADD COLUMN subject_id TEXT;
ALTER TABLE tag_aliases ADD COLUMN subject_id TEXT;
ALTER TABLE problems ADD COLUMN subject_id TEXT;
ALTER TABLE problem_tags ADD COLUMN subject_id TEXT;

UPDATE textbooks
SET subject_id = (SELECT id FROM subjects WHERE name = textbooks.subject);
UPDATE knowledge_nodes
SET subject_id = (SELECT id FROM subjects WHERE name = knowledge_nodes.subject);
UPDATE knowledge_edges
SET subject_id = (SELECT id FROM subjects WHERE name = knowledge_edges.subject);
UPDATE tag_definitions
SET subject_id = (SELECT id FROM subjects WHERE name = tag_definitions.subject);
UPDATE tag_aliases
SET subject_id = (SELECT id FROM subjects WHERE name = tag_aliases.subject);
UPDATE problems
SET subject_id = (
  SELECT id FROM subjects
  WHERE name = trim(COALESCE(
    NULLIF(problems.user_subject, ''),
    NULLIF(problems.ai_subject, ''),
    NULLIF(problems.subject, '')
  ))
);
UPDATE problem_tags
SET subject_id = COALESCE(
  (SELECT subject_id FROM tag_definitions WHERE id = problem_tags.tag_id),
  (SELECT subject_id FROM problems WHERE id = problem_tags.problem_id),
  (SELECT id FROM subjects WHERE name = problem_tags.subject)
);

CREATE INDEX idx_textbooks_subject_id ON textbooks(subject_id, archived_at, updated_at DESC);
CREATE INDEX idx_knowledge_nodes_subject_id ON knowledge_nodes(subject_id, textbook_id, archived_at);
CREATE INDEX idx_knowledge_edges_subject_id ON knowledge_edges(subject_id);
CREATE INDEX idx_tag_definitions_subject_id ON tag_definitions(subject_id, tag_type, lifecycle_status, canonical_name);
CREATE INDEX idx_tag_aliases_subject_id ON tag_aliases(subject_id, alias COLLATE NOCASE);
CREATE INDEX idx_problems_subject_id ON problems(subject_id, archived_at, deleted_at);
CREATE INDEX idx_problem_tags_subject_id ON problem_tags(subject_id, tag_type, superseded_at);

-- Legacy ingestion paths still write the display-name compatibility column.
-- These adapters translate once at the persistence boundary; all tag lookup
-- and mapping paths consume the stable subject_id afterwards.
CREATE TRIGGER trg_textbooks_subject_identity_insert
AFTER INSERT ON textbooks
WHEN NEW.subject_id IS NULL
BEGIN
  UPDATE textbooks SET subject_id = (SELECT id FROM subjects WHERE name = trim(NEW.subject))
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_knowledge_nodes_subject_identity_insert
AFTER INSERT ON knowledge_nodes
WHEN NEW.subject_id IS NULL
BEGIN
  UPDATE knowledge_nodes SET subject_id = (SELECT id FROM subjects WHERE name = trim(NEW.subject))
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_knowledge_edges_subject_identity_insert
AFTER INSERT ON knowledge_edges
WHEN NEW.subject_id IS NULL
BEGIN
  UPDATE knowledge_edges SET subject_id = (SELECT id FROM subjects WHERE name = trim(NEW.subject))
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_tag_definitions_subject_identity_insert
AFTER INSERT ON tag_definitions
WHEN NEW.subject_id IS NULL
BEGIN
  UPDATE tag_definitions SET subject_id = (SELECT id FROM subjects WHERE name = trim(NEW.subject))
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_tag_aliases_subject_identity_insert
AFTER INSERT ON tag_aliases
WHEN NEW.subject_id IS NULL
BEGIN
  UPDATE tag_aliases SET subject_id = (SELECT id FROM subjects WHERE name = trim(NEW.subject))
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_problems_subject_identity_insert
AFTER INSERT ON problems
WHEN NEW.subject_id IS NULL
BEGIN
  UPDATE problems SET subject_id = (
    SELECT id FROM subjects WHERE name = trim(COALESCE(
      NULLIF(NEW.user_subject, ''), NULLIF(NEW.ai_subject, ''), NULLIF(NEW.subject, '')
    ))
  ) WHERE id = NEW.id;
END;

CREATE TRIGGER trg_problems_subject_identity_update
AFTER UPDATE OF subject, ai_subject, user_subject ON problems
BEGIN
  UPDATE problems SET subject_id = (
    SELECT id FROM subjects WHERE name = trim(COALESCE(
      NULLIF(NEW.user_subject, ''), NULLIF(NEW.ai_subject, ''), NULLIF(NEW.subject, '')
    ))
  ) WHERE id = NEW.id;
END;

CREATE TRIGGER trg_problem_tags_subject_identity_insert
AFTER INSERT ON problem_tags
WHEN NEW.subject_id IS NULL
BEGIN
  UPDATE problem_tags SET subject_id = COALESCE(
    (SELECT subject_id FROM tag_definitions WHERE id = NEW.tag_id),
    (SELECT subject_id FROM problems WHERE id = NEW.problem_id)
  ) WHERE id = NEW.id;
END;

CREATE TRIGGER trg_problem_tags_subject_identity_guard
BEFORE INSERT ON problem_tags
WHEN NEW.subject_id IS NOT NULL AND (
  NEW.subject_id != (SELECT subject_id FROM problems WHERE id = NEW.problem_id)
  OR (NEW.tag_id IS NOT NULL AND NEW.subject_id != (
    SELECT subject_id FROM tag_definitions WHERE id = NEW.tag_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'problem and tag subject identities must match');
END;
