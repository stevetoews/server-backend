import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { getDbClient } from "../client.js";

export interface IncidentRecord {
  checkType?: string;
  id: string;
  openedAt: string;
  resolvedAt?: string;
  serverId: string;
  severity: "warning" | "critical";
  status: "open" | "remediation_pending" | "resolved" | "closed";
  summary?: string;
  title: string;
}

function mapIncidentRow(row: Record<string, unknown>): IncidentRecord {
  return {
    id: String(row.id),
    serverId: String(row.server_id),
    severity: String(row.severity) as IncidentRecord["severity"],
    status: String(row.status) as IncidentRecord["status"],
    title: String(row.title),
    openedAt: String(row.opened_at),
    ...(typeof row.summary === "string" ? { summary: row.summary } : {}),
    ...(typeof row.resolved_at === "string" ? { resolvedAt: row.resolved_at } : {}),
    ...(typeof row.check_type === "string" ? { checkType: row.check_type } : {}),
  };
}

export async function getActiveIncidentForServerCheck(input: {
  checkType: string;
  serverId: string;
}): Promise<IncidentRecord | null> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT id, server_id, severity, status, title, summary, opened_at, resolved_at, check_type
      FROM incidents
      WHERE server_id = ?
        AND check_type = ?
        AND status IN ('open', 'remediation_pending')
      LIMIT 1
    `,
    args: [input.serverId, input.checkType],
  });

  const row = result.rows[0];
  return row ? mapIncidentRow(row as Record<string, unknown>) : null;
}

export async function createIncident(input: {
  checkType: string;
  serverId: string;
  severity: IncidentRecord["severity"];
  summary: string;
  title: string;
}): Promise<IncidentRecord> {
  const db = getDbClient();
  const id = randomUUID();
  const openedAt = new Date().toISOString();

  await db.execute({
    sql: `
      INSERT INTO incidents (
        id,
        server_id,
        severity,
        status,
        title,
        summary,
        opened_at,
        check_type
      )
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?)
    `,
    args: [
      id,
      input.serverId,
      input.severity,
      input.title,
      input.summary,
      openedAt,
      input.checkType,
    ],
  } satisfies InStatement);

  return {
    id,
    serverId: input.serverId,
    severity: input.severity,
    status: "open",
    title: input.title,
    summary: input.summary,
    openedAt,
    checkType: input.checkType,
  };
}

export async function updateIncidentSummary(input: {
  id: string;
  summary: string;
  title: string;
}): Promise<void> {
  const db = getDbClient();
  await db.execute({
    sql: `
      UPDATE incidents
      SET title = ?,
          summary = ?
      WHERE id = ?
    `,
    args: [input.title, input.summary, input.id],
  });
}

export async function resolveIncident(id: string): Promise<void> {
  const db = getDbClient();
  await db.execute({
    sql: `
      UPDATE incidents
      SET status = 'resolved',
          resolved_at = ?
      WHERE id = ?
    `,
    args: [new Date().toISOString(), id],
  });
}

export async function markIncidentRemediationPending(id: string): Promise<void> {
  const db = getDbClient();
  await db.execute({
    sql: `
      UPDATE incidents
      SET status = 'remediation_pending'
      WHERE id = ?
    `,
    args: [id],
  });
}

export async function closeIncident(id: string): Promise<void> {
  const db = getDbClient();
  await db.execute({
    sql: `
      UPDATE incidents
      SET status = 'closed'
      WHERE id = ?
    `,
    args: [id],
  });
}

export async function listIncidents(
  limit = 20,
  offset = 0,
): Promise<IncidentRecord[]> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT id, server_id, severity, status, title, summary, opened_at, resolved_at, check_type
      FROM incidents
      WHERE status != 'closed'
      ORDER BY opened_at DESC
      LIMIT ?
      OFFSET ?
    `,
    args: [limit, offset],
  });

  return result.rows.map((row) => mapIncidentRow(row as Record<string, unknown>));
}

export async function countIncidents(): Promise<number> {
  const db = getDbClient();
  const result = await db.execute(`
    SELECT COUNT(*) AS total
    FROM incidents
    WHERE status != 'closed'
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row.total ?? 0) : 0;
}

export async function listIncidentsByServerId(
  serverId: string,
  limit = 20,
  offset = 0,
): Promise<IncidentRecord[]> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT id, server_id, severity, status, title, summary, opened_at, resolved_at, check_type
      FROM incidents
      WHERE server_id = ?
        AND status != 'closed'
      ORDER BY opened_at DESC
      LIMIT ?
      OFFSET ?
    `,
    args: [serverId, limit, offset],
  });

  return result.rows.map((row) => mapIncidentRow(row as Record<string, unknown>));
}

export async function countIncidentsByServerId(serverId: string): Promise<number> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT COUNT(*) AS total
      FROM incidents
      WHERE server_id = ?
        AND status != 'closed'
    `,
    args: [serverId],
  });

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row.total ?? 0) : 0;
}

export async function getIncidentById(id: string): Promise<IncidentRecord | null> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT id, server_id, severity, status, title, summary, opened_at, resolved_at, check_type
      FROM incidents
      WHERE id = ?
      LIMIT 1
    `,
    args: [id],
  });

  const row = result.rows[0];
  return row ? mapIncidentRow(row as Record<string, unknown>) : null;
}
