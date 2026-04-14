ALTER TABLE incidents ADD COLUMN check_type TEXT;

CREATE INDEX IF NOT EXISTS idx_incidents_server_check_status
ON incidents (server_id, check_type, status);
