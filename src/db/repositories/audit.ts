import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { getDbClient } from "../client.js";
import { parseJsonColumn, serializeJsonColumn } from "../sql.js";

export interface PersistedAuditEvent {
  actorId?: string;
  actorType: "system" | "user";
  eventType: string;
  metadata?: Record<string, unknown>;
  targetId: string;
  targetType: string;
}

export interface AuditLogRecord extends PersistedAuditEvent {
  createdAt: string;
  id: string;
}

export async function createAuditLog(
  input: PersistedAuditEvent,
): Promise<{ createdAt: string; id: string }> {
  const db = getDbClient();
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  await db.execute({
    sql: `
      INSERT INTO audit_logs (
        id,
        actor_type,
        actor_id,
        event_type,
        target_type,
        target_id,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      input.actorType,
      input.actorId ?? null,
      input.eventType,
      input.targetType,
      input.targetId,
      input.metadata ? serializeJsonColumn(input.metadata) : null,
      createdAt,
    ],
  } satisfies InStatement);

  return { id, createdAt };
}

function mapAuditLogRow(row: Record<string, unknown>): AuditLogRecord {
  return {
    id: String(row.id),
    actorType: String(row.actor_type) as AuditLogRecord["actorType"],
    eventType: String(row.event_type),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    createdAt: String(row.created_at),
    ...(typeof row.actor_id === "string" ? { actorId: row.actor_id } : {}),
    ...(typeof row.metadata_json === "string"
      ? {
          metadata: parseJsonColumn<Record<string, unknown>>(row.metadata_json, {}),
        }
      : {}),
  };
}

export async function listAuditLogs(input?: {
  offset?: number;
  limit?: number;
  targetId?: string;
  targetType?: string;
}): Promise<AuditLogRecord[]> {
  const db = getDbClient();
  const limit = input?.limit ?? 50;
  const offset = input?.offset ?? 0;

  if (input?.targetType && input?.targetId) {
    const result = await db.execute({
      sql: `
        SELECT id, actor_type, actor_id, event_type, target_type, target_id, metadata_json, created_at
        FROM audit_logs
        WHERE target_type = ?
          AND target_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        OFFSET ?
      `,
      args: [input.targetType, input.targetId, limit, offset],
    });

    return result.rows.map((row) => mapAuditLogRow(row as Record<string, unknown>));
  }

  const result = await db.execute({
    sql: `
      SELECT id, actor_type, actor_id, event_type, target_type, target_id, metadata_json, created_at
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `,
    args: [limit, offset],
  });

  return result.rows.map((row) => mapAuditLogRow(row as Record<string, unknown>));
}
