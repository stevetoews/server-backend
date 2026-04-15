import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { getDbClient } from "../client.js";

export type NotificationTransportKind = "smtp" | "simulated";

export interface NotificationDeliveryRecord {
  bodyText: string;
  createdAt: string;
  errorMessage?: string;
  eventType: string;
  id: string;
  transportKind?: NotificationTransportKind;
  transportResponse?: string;
  status: "delivered" | "failed" | "skipped";
  subject: string;
  targetId: string;
}

function mapNotificationDeliveryRow(row: Record<string, unknown>): NotificationDeliveryRecord {
  const record: NotificationDeliveryRecord = {
    id: String(row.id),
    targetId: String(row.target_id),
    eventType: String(row.event_type),
    subject: String(row.subject),
    bodyText: String(row.body_text),
    status: String(row.status) as NotificationDeliveryRecord["status"],
    createdAt: String(row.created_at),
  };

  if (typeof row.transport_kind === "string") {
    record.transportKind = row.transport_kind as NotificationTransportKind;
  }

  if (typeof row.transport_response === "string") {
    record.transportResponse = row.transport_response;
  }

  if (typeof row.error_message === "string") {
    record.errorMessage = row.error_message;
  }

  return record;
}

export async function createNotificationDelivery(input: {
  bodyText: string;
  errorMessage?: string;
  eventType: string;
  status: NotificationDeliveryRecord["status"];
  subject: string;
  targetId: string;
  transportKind?: NotificationTransportKind;
  transportResponse?: string;
}): Promise<NotificationDeliveryRecord> {
  const db = getDbClient();
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  await db.execute({
    sql: `
      INSERT INTO notification_deliveries (
        id,
        target_id,
        event_type,
        subject,
        body_text,
        status,
        transport_kind,
        transport_response,
        error_message,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      input.targetId,
      input.eventType,
      input.subject,
      input.bodyText,
      input.status,
      input.transportKind ?? null,
      input.transportResponse ?? null,
      input.errorMessage ?? null,
      createdAt,
    ],
  } satisfies InStatement);

  const record: NotificationDeliveryRecord = {
    id,
    targetId: input.targetId,
    eventType: input.eventType,
    subject: input.subject,
    bodyText: input.bodyText,
    status: input.status,
    createdAt,
  };

  if (input.transportKind) {
    record.transportKind = input.transportKind;
  }

  if (input.transportResponse) {
    record.transportResponse = input.transportResponse;
  }

  if (input.errorMessage) {
    record.errorMessage = input.errorMessage;
  }

  return record;
}

export async function listNotificationDeliveries(
  input?: {
    eventType?: string;
    offset?: number;
    limit?: number;
    targetId?: string;
  },
): Promise<NotificationDeliveryRecord[]> {
  const db = getDbClient();
  const limit = input?.limit ?? 50;
  const offset = input?.offset ?? 0;

  if (input?.targetId && input?.eventType) {
    const result = await db.execute({
      sql: `
        SELECT id, target_id, event_type, subject, body_text, status, transport_kind, transport_response, error_message, created_at
        FROM notification_deliveries
        WHERE target_id = ?
          AND event_type = ?
        ORDER BY created_at DESC
        LIMIT ?
        OFFSET ?
      `,
      args: [input.targetId, input.eventType, limit, offset],
    });

    return result.rows.map((row) => mapNotificationDeliveryRow(row as Record<string, unknown>));
  }

  if (input?.targetId) {
    const result = await db.execute({
      sql: `
        SELECT id, target_id, event_type, subject, body_text, status, transport_kind, transport_response, error_message, created_at
        FROM notification_deliveries
        WHERE target_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        OFFSET ?
      `,
      args: [input.targetId, limit, offset],
    });

    return result.rows.map((row) => mapNotificationDeliveryRow(row as Record<string, unknown>));
  }

  if (input?.eventType) {
    const result = await db.execute({
      sql: `
        SELECT id, target_id, event_type, subject, body_text, status, transport_kind, transport_response, error_message, created_at
        FROM notification_deliveries
        WHERE event_type = ?
        ORDER BY created_at DESC
        LIMIT ?
        OFFSET ?
      `,
      args: [input.eventType, limit, offset],
    });

    return result.rows.map((row) => mapNotificationDeliveryRow(row as Record<string, unknown>));
  }

  const result = await db.execute({
    sql: `
      SELECT id, target_id, event_type, subject, body_text, status, transport_kind, transport_response, error_message, created_at
      FROM notification_deliveries
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `,
    args: [limit, offset],
  });

  return result.rows.map((row) => mapNotificationDeliveryRow(row as Record<string, unknown>));
}

export async function countNotificationDeliveries(input?: {
  eventType?: string;
  targetId?: string;
}): Promise<number> {
  const db = getDbClient();

  if (input?.targetId && input?.eventType) {
    const result = await db.execute({
      sql: `
        SELECT COUNT(*) AS total
        FROM notification_deliveries
        WHERE target_id = ?
          AND event_type = ?
      `,
      args: [input.targetId, input.eventType],
    });

    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? Number(row.total ?? 0) : 0;
  }

  if (input?.targetId) {
    const result = await db.execute({
      sql: `
        SELECT COUNT(*) AS total
        FROM notification_deliveries
        WHERE target_id = ?
      `,
      args: [input.targetId],
    });

    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? Number(row.total ?? 0) : 0;
  }

  if (input?.eventType) {
    const result = await db.execute({
      sql: `
        SELECT COUNT(*) AS total
        FROM notification_deliveries
        WHERE event_type = ?
      `,
      args: [input.eventType],
    });

    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? Number(row.total ?? 0) : 0;
  }

  const result = await db.execute(`
    SELECT COUNT(*) AS total
    FROM notification_deliveries
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row.total ?? 0) : 0;
}
