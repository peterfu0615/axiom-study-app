CREATE TABLE IF NOT EXISTS problem_library_profiles (
  problem_id TEXT PRIMARY KEY NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 20000),
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problem_library_profiles_favorite
  ON problem_library_profiles(is_favorite, updated_at DESC);

CREATE TABLE IF NOT EXISTS problem_duplicate_decisions (
  first_problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  second_problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('keep_both', 'merged')),
  canonical_problem_id TEXT REFERENCES problems(id) ON DELETE CASCADE,
  similarity_score REAL NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1),
  signals_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(signals_json) AND json_type(signals_json) = 'array'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(first_problem_id, second_problem_id),
  CHECK (first_problem_id < second_problem_id),
  CHECK (
    (decision = 'keep_both' AND canonical_problem_id IS NULL)
    OR
    (decision = 'merged' AND canonical_problem_id IS NOT NULL
      AND canonical_problem_id IN (first_problem_id, second_problem_id))
  )
);

CREATE INDEX IF NOT EXISTS idx_problem_duplicate_decisions_canonical
  ON problem_duplicate_decisions(canonical_problem_id, decision);

CREATE VIEW IF NOT EXISTS problem_library_search_source AS
SELECT
  problem.id AS problem_id,
  trim(COALESCE(NULLIF(problem.user_subject,''),NULLIF(problem.ai_subject,''),problem.subject,'')) AS subject,
  COALESCE(NULLIF(problem.user_title,''),NULLIF(problem.ai_title,''),problem.title,'') AS title,
  COALESCE(NULLIF(problem.user_stem_markdown,''),NULLIF(problem.ai_stem_markdown,''),problem.stem_markdown,'') AS stem,
  COALESCE((
    SELECT solution.content_markdown FROM problem_solutions solution
    WHERE solution.problem_id=problem.id AND solution.status='completed'
    ORDER BY solution.updated_at DESC LIMIT 1
  ),'') AS answer,
  COALESCE((
    SELECT group_concat(COALESCE(definition.canonical_name,tag.candidate_name,'') || ' ' || COALESCE(tag.evidence,''),' ')
    FROM problem_tags tag LEFT JOIN tag_definitions definition ON definition.id=tag.tag_id
    WHERE tag.problem_id=problem.id AND tag.superseded_at IS NULL AND tag.mapping_status!='rejected'
  ),'') AS tags,
  COALESCE((SELECT profile.note FROM problem_library_profiles profile WHERE profile.problem_id=problem.id),'') AS note
FROM problems problem
WHERE problem.status='saved';

CREATE VIRTUAL TABLE IF NOT EXISTS problem_library_fts USING fts5(
  problem_id UNINDEXED,
  subject,
  title,
  stem,
  answer,
  tags,
  note,
  tokenize='trigram'
);

INSERT INTO problem_library_fts(problem_id,subject,title,stem,answer,tags,note)
SELECT problem_id,subject,title,stem,answer,tags,note FROM problem_library_search_source;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_problem_insert
AFTER INSERT ON problems BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=NEW.id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_problem_update
AFTER UPDATE ON problems BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=NEW.id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_problem_delete
AFTER DELETE ON problems BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_profile_insert
AFTER INSERT ON problem_library_profiles BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=NEW.problem_id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=NEW.problem_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_profile_update
AFTER UPDATE ON problem_library_profiles BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=NEW.problem_id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=NEW.problem_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_profile_delete
AFTER DELETE ON problem_library_profiles BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=OLD.problem_id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=OLD.problem_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_solution_insert
AFTER INSERT ON problem_solutions BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=NEW.problem_id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=NEW.problem_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_solution_update
AFTER UPDATE ON problem_solutions BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=NEW.problem_id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=NEW.problem_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_solution_delete
AFTER DELETE ON problem_solutions BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=OLD.problem_id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=OLD.problem_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_tag_insert
AFTER INSERT ON problem_tags BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=NEW.problem_id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=NEW.problem_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_tag_update
AFTER UPDATE ON problem_tags BEGIN
  DELETE FROM problem_library_fts WHERE problem_id IN (OLD.problem_id,NEW.problem_id);
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source
    WHERE problem_id IN (OLD.problem_id,NEW.problem_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_tag_delete
AFTER DELETE ON problem_tags BEGIN
  DELETE FROM problem_library_fts WHERE problem_id=OLD.problem_id;
  INSERT INTO problem_library_fts SELECT * FROM problem_library_search_source WHERE problem_id=OLD.problem_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_problem_library_fts_definition_update
AFTER UPDATE OF canonical_name ON tag_definitions BEGIN
  DELETE FROM problem_library_fts WHERE problem_id IN (
    SELECT problem_id FROM problem_tags WHERE tag_id=NEW.id
  );
  INSERT INTO problem_library_fts
    SELECT source.* FROM problem_library_search_source source
    WHERE source.problem_id IN (SELECT problem_id FROM problem_tags WHERE tag_id=NEW.id);
END;
