CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  environment TEXT NOT NULL,
  hostname TEXT NOT NULL,
  ip_address TEXT,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_username TEXT NOT NULL,
  ssh_auth_mode TEXT NOT NULL,
  ssh_key_ref TEXT,
  onboarding_status TEXT NOT NULL DEFAULT 'draft',
  os_name TEXT,
  os_version TEXT,
  provider_kind TEXT,
  provider_instance_id TEXT,
  provider_match_confidence REAL,
  provider_match_reasons_json TEXT,
  spinupwp_server_id TEXT,
  monitoring_enabled INTEGER NOT NULL DEFAULT 1,
  allow_auto_reboot INTEGER NOT NULL DEFAULT 0,
  max_auto_reboots_per_24h INTEGER NOT NULL DEFAULT 1,
  last_auto_reboot_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id),
  domain TEXT NOT NULL,
  site_path TEXT NOT NULL,
  app_type TEXT NOT NULL,
  wp_cli_path TEXT,
  php_version TEXT,
  cache_type TEXT,
  spinupwp_site_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_checks (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id),
  site_id TEXT REFERENCES sites(id),
  check_type TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  summary TEXT,
  raw_output_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id),
  site_id TEXT REFERENCES sites(id),
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  opened_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS remediation_runs (
  id TEXT PRIMARY KEY,
  incident_id TEXT REFERENCES incidents(id),
  server_id TEXT REFERENCES servers(id),
  site_id TEXT REFERENCES sites(id),
  action_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  command_text TEXT,
  request_json TEXT,
  response_json TEXT,
  output_snippet TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
