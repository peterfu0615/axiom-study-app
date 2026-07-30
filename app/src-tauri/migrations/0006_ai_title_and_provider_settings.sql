ALTER TABLE problems ADD COLUMN ai_title TEXT;

CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id = 'default'),
  provider TEXT NOT NULL DEFAULT 'mock'
    CHECK (provider IN ('mock', 'openai_compatible')),
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  encrypted_api_key TEXT,
  api_key_nonce TEXT,
  enabled INTEGER NOT NULL DEFAULT 0
    CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO ai_provider_settings (
  id,
  provider,
  base_url,
  model,
  encrypted_api_key,
  api_key_nonce,
  enabled,
  updated_at
) VALUES (
  'default',
  'mock',
  '',
  '',
  NULL,
  NULL,
  0,
  0
);
