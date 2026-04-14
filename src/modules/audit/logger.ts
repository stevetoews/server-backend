import { randomUUID } from "node:crypto";

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
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  };
}
