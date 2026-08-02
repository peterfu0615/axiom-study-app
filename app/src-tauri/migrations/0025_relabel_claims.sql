-- Give relabel workers a durable claim token.  A claim is separate from the
-- model run so pausing a batch cannot turn a pending item into an unowned AI
-- request between two IPC calls.

BEGIN IMMEDIATE;

ALTER TABLE tag_relabel_items ADD COLUMN claim_token TEXT;
ALTER TABLE tag_relabel_items ADD COLUMN claimed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_relabel_items_claim
  ON tag_relabel_items(batch_id, status, claim_token, created_at);

COMMIT;
