-- Bring durable curriculum AI attempts under the shared structured error
-- contract. Keep error_message for older readers and existing rows.

ALTER TABLE curriculum_import_jobs ADD COLUMN error_code TEXT;
ALTER TABLE curriculum_import_jobs ADD COLUMN error_json TEXT;

ALTER TABLE curriculum_import_attempts ADD COLUMN error_code TEXT;
ALTER TABLE curriculum_import_attempts ADD COLUMN error_json TEXT;
