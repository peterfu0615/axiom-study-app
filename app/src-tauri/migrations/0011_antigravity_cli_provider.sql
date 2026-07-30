CREATE TABLE ai_provider_profiles_v11 (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (
    provider IN ('mock', 'openai_compatible', 'antigravity_cli')
  ),
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  command_path TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  supports_vision INTEGER NOT NULL DEFAULT 1 CHECK (supports_vision IN (0, 1)),
  supports_text INTEGER NOT NULL DEFAULT 1 CHECK (supports_text IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO ai_provider_profiles_v11 (
  id, name, provider, base_url, api_key, command_path, model,
  supports_vision, supports_text, enabled, sort_order, created_at, updated_at
)
SELECT
  id, name, provider, base_url, api_key, '', model,
  supports_vision, supports_text, enabled, sort_order, created_at, updated_at
FROM ai_provider_profiles;

DROP TABLE ai_provider_profiles;
ALTER TABLE ai_provider_profiles_v11 RENAME TO ai_provider_profiles;

CREATE INDEX idx_ai_provider_profiles_order
  ON ai_provider_profiles(enabled DESC, sort_order ASC);
