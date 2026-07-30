ALTER TABLE problems ADD COLUMN user_knowledge_points_json TEXT;

CREATE TABLE IF NOT EXISTS ai_provider_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('mock', 'openai_compatible')),
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  supports_vision INTEGER NOT NULL DEFAULT 1 CHECK (supports_vision IN (0, 1)),
  supports_text INTEGER NOT NULL DEFAULT 1 CHECK (supports_text IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_profiles_order
  ON ai_provider_profiles(enabled DESC, sort_order ASC);

INSERT OR IGNORE INTO ai_provider_profiles (
  id, name, provider, base_url, api_key, model,
  supports_vision, supports_text, enabled, sort_order, created_at, updated_at
) VALUES (
  'mock-default', 'Mock Provider', 'mock', '', '', 'mock-vision-v1',
  1, 1, 1, 0,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);
