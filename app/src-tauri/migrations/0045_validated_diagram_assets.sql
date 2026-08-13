-- A rendered file is only eligible for printable documents after validation.
ALTER TABLE diagrams ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'unvalidated'
  CHECK (validation_status IN ('unvalidated', 'validated', 'rejected'));
ALTER TABLE diagrams ADD COLUMN validation_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(validation_json));
ALTER TABLE diagrams ADD COLUMN contract_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(contract_json));
ALTER TABLE diagrams ADD COLUMN width_units REAL;
ALTER TABLE diagrams ADD COLUMN height_units REAL;
ALTER TABLE diagrams ADD COLUMN repair_attempts INTEGER NOT NULL DEFAULT 0
  CHECK (repair_attempts BETWEEN 0 AND 2);

-- Existing assets predate bounding-box, visual and semantic checks.
UPDATE diagrams SET validation_status='unvalidated';

CREATE INDEX IF NOT EXISTS idx_diagrams_validated_owner
  ON diagrams(owner_type, owner_id, validation_status, created_at);
