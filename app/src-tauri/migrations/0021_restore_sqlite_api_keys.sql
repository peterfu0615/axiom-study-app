-- `api_key` is the durable local source of truth again.  This table records
-- the one-time best-effort recovery from versions that moved the value into
-- Keychain and cleared SQLite.  It contains no credential material.
CREATE TABLE IF NOT EXISTS ai_provider_api_key_recovery_attempts (
  provider_id TEXT PRIMARY KEY NOT NULL
    REFERENCES ai_provider_profiles(id) ON DELETE CASCADE,
  attempted_at INTEGER NOT NULL,
  recovered_at INTEGER,
  error_code TEXT
);
