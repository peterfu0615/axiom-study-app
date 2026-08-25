-- OpenAI-compatible endpoint interpretation and structured-output preferences.
ALTER TABLE ai_provider_profiles
  ADD COLUMN endpoint_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (endpoint_mode IN ('auto', 'api_root', 'v1_base', 'full_endpoint'));

ALTER TABLE ai_provider_profiles
  ADD COLUMN structured_output_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (structured_output_mode IN ('auto', 'json_schema', 'json_object', 'prompt_only'));

CREATE TABLE ai_provider_capabilities (
  provider_id TEXT NOT NULL REFERENCES ai_provider_profiles(id) ON DELETE CASCADE,
  endpoint_url TEXT NOT NULL,
  model TEXT NOT NULL,
  best_structured_output_mode TEXT NOT NULL
    CHECK (best_structured_output_mode IN ('json_schema', 'json_object', 'prompt_only')),
  tested_at INTEGER NOT NULL,
  last_error_code TEXT,
  PRIMARY KEY (provider_id, endpoint_url, model)
);
