-- Diagram is the source-of-truth for generated and extracted visuals.
-- Rendered files are cacheable representations; source remains durable.
CREATE TABLE IF NOT EXISTS diagrams (
  id TEXT PRIMARY KEY NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('problem', 'practice_item')),
  owner_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('tikz', 'image')),
  source TEXT NOT NULL,
  render_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (render_status IN ('pending', 'rendered', 'failed')),
  rendered_asset_path TEXT,
  rendered_mime_type TEXT,
  render_hash TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  render_error_code TEXT,
  render_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (render_status = 'rendered' AND rendered_asset_path IS NOT NULL AND rendered_mime_type IS NOT NULL)
    OR render_status != 'rendered'
  )
);

CREATE INDEX IF NOT EXISTS idx_diagrams_owner
  ON diagrams(owner_type, owner_id, created_at);

CREATE INDEX IF NOT EXISTS idx_diagrams_render_cache
  ON diagrams(render_hash, renderer_version, render_status);
