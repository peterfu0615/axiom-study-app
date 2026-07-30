CREATE TABLE IF NOT EXISTS problem_solutions (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL UNIQUE
    REFERENCES problems(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN (
      'not_started',
      'pending',
      'processing',
      'completed',
      'failed'
    )),
  content_markdown TEXT,
  steps_json TEXT NOT NULL DEFAULT '[]',
  key_method TEXT,
  used_formulas_json TEXT NOT NULL DEFAULT '[]',
  knowledge_points_json TEXT NOT NULL DEFAULT '[]',
  active_model_run_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problem_solutions_status
  ON problem_solutions(status, updated_at);

INSERT OR IGNORE INTO problem_solutions (
  id,
  problem_id,
  status,
  content_markdown,
  steps_json,
  key_method,
  used_formulas_json,
  knowledge_points_json,
  active_model_run_id,
  error_message,
  created_at,
  updated_at
)
SELECT
  'legacy-' || id,
  id,
  'completed',
  json_extract(solution_json, '$.content_markdown'),
  CASE
    WHEN json_type(solution_json, '$.steps') = 'array'
      AND json_array_length(json_extract(solution_json, '$.steps')) > 0
    THEN json_extract(solution_json, '$.steps')
    ELSE json_array(json_object(
      'index', 1,
      'title', '标准解答',
      'content_markdown', json_extract(solution_json, '$.content_markdown')
    ))
  END,
  json_extract(solution_json, '$.key_method'),
  CASE
    WHEN json_type(solution_json, '$.used_formulas') = 'array'
    THEN json_extract(solution_json, '$.used_formulas')
    ELSE '[]'
  END,
  CASE
    WHEN json_type(solution_json, '$.knowledge_points') = 'array'
    THEN json_extract(solution_json, '$.knowledge_points')
    ELSE '[]'
  END,
  NULL,
  NULL,
  created_at,
  updated_at
FROM problems
WHERE solution_json IS NOT NULL
  AND json_valid(solution_json)
  AND trim(COALESCE(
    json_extract(solution_json, '$.content_markdown'),
    ''
  )) <> '';
