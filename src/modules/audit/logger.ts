import { createAuditLog } from "../../db/repositories/audit.js";

export interface AuditEventInput {
  actorId?: string;
  actorType: "system" | "user";
  eventType: string;
  metadata?: Record<string, unknown>;
  targetId: string;
  targetType: string;
}

export interface AuditEventRecord extends AuditEventInput {
  createdAt: string;
  id: string;
}

export async function writeAuditEvent(input: AuditEventInput): Promise<AuditEventRecord> {
  const persisted = await createAuditLog(input);

  return {
    id: persisted.id,
    createdAt: persisted.createdAt,
    ...input,
  };
}
