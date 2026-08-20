-- Per-task AI provider routing. An empty array preserves the historical
-- behaviour: the provider may serve every task compatible with its declared
-- vision/text capabilities.
ALTER TABLE ai_provider_profiles
  ADD COLUMN task_types_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(task_types_json) AND json_type(task_types_json) = 'array');
