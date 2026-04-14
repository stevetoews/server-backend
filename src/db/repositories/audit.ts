import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { getDbClient } from "../client.js";
import { serializeJsonColumn } from "../sql.js";

export interface PersistedAuditEvent {
  actorId?: string;
  actorType: "system" | "user";
  eventType: string;
  metadata?: Record<string, unknown>;
  targetId: string;
  targetType: string;
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
