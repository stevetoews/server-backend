ALTER TABLE notification_deliveries
  ADD COLUMN transport_kind TEXT;

ALTER TABLE notification_deliveries
  ADD COLUMN transport_response TEXT;
