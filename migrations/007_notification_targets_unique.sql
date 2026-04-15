DELETE FROM notification_targets
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM notification_targets
  GROUP BY channel, address
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_targets_channel_address
  ON notification_targets (channel, address);
