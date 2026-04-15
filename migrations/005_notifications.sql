CREATE TABLE IF NOT EXISTS notification_targets (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES notification_targets(id),
  event_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL,
  transport_kind TEXT,
  transport_response TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_targets_enabled
  ON notification_targets (enabled, channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_event_created_at
  ON notification_deliveries (event_type, created_at DESC);
