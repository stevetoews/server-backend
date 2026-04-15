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
    status?: NotificationDeliveryRecord["status"];
    targetId?: string;
  },
): Promise<NotificationDeliveryRecord[]> {
  const db = getDbClient();
  const limit = input?.limit ?? 50;
  const offset = input?.offset ?? 0;
  const conditions: string[] = [];
  const args: Array<string | number> = [];

  if (input?.targetId) {
    conditions.push("target_id = ?");
    args.push(input.targetId);
  }

  if (input?.eventType) {
    conditions.push("event_type = ?");
    args.push(input.eventType);
  }

  if (input?.status) {
    conditions.push("status = ?");
    args.push(input.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.execute({
    sql: `
      SELECT id, target_id, event_type, subject, body_text, status, transport_kind, transport_response, error_message, created_at
      FROM notification_deliveries
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `,
    args: [...args, limit, offset],
  });

  return result.rows.map((row) => mapNotificationDeliveryRow(row as Record<string, unknown>));
}

export async function countNotificationDeliveries(input?: {
  eventType?: string;
  status?: NotificationDeliveryRecord["status"];
  targetId?: string;
}): Promise<number> {
  const db = getDbClient();

  const conditions: string[] = [];
  const args: Array<string | number> = [];

  if (input?.targetId) {
    conditions.push("target_id = ?");
    args.push(input.targetId);
  }

  if (input?.eventType) {
    conditions.push("event_type = ?");
    args.push(input.eventType);
  }

  if (input?.status) {
    conditions.push("status = ?");
    args.push(input.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.execute({
    sql: `
      SELECT COUNT(*) AS total
      FROM notification_deliveries
      ${whereClause}
    `,
    args,
  });

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row.total ?? 0) : 0;
}
