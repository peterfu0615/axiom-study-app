-- Preserve honest per-run AI usage and optional user-configured pricing.
-- NULL means the provider did not report usage or pricing is not configured.

ALTER TABLE ai_provider_profiles
  ADD COLUMN input_cost_per_million_usd REAL;
ALTER TABLE ai_provider_profiles
  ADD COLUMN output_cost_per_million_usd REAL;

ALTER TABLE model_runs
  ADD COLUMN prompt_tokens INTEGER;
ALTER TABLE model_runs
  ADD COLUMN completion_tokens INTEGER;
ALTER TABLE model_runs
  ADD COLUMN estimated_cost_usd REAL;

ALTER TABLE provider_attempts
  ADD COLUMN prompt_tokens INTEGER;
ALTER TABLE provider_attempts
  ADD COLUMN completion_tokens INTEGER;
ALTER TABLE provider_attempts
  ADD COLUMN token_usage INTEGER;
ALTER TABLE provider_attempts
  ADD COLUMN estimated_cost_usd REAL;
