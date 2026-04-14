CREATE INDEX IF NOT EXISTS idx_servers_onboarding_status ON servers (onboarding_status);
CREATE INDEX IF NOT EXISTS idx_servers_provider_kind ON servers (provider_kind);
CREATE INDEX IF NOT EXISTS idx_health_checks_server_created_at ON health_checks (server_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_server_status ON incidents (server_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_created_at ON audit_logs (target_type, target_id, created_at DESC);
