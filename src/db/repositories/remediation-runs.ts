import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { getDbClient } from "../client.js";
import { parseJsonColumn, serializeJsonColumn } from "../sql.js";

export interface RemediationRunRecord {
  actionType: string;
  commandText?: string;
  finishedAt?: string;
  id: string;
  incidentId: string;
  outputSnippet?: string;
  provider: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  serverId: string;
  startedAt: string;
  status: "running" | "succeeded" | "failed";
}

function mapRemediationRunRow(row: Record<string, unknown>): RemediationRunRecord {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    serverId: String(row.server_id),
    actionType: String(row.action_type),
    provider: String(row.provider),
    status: String(row.status) as RemediationRunRecord["status"],
    startedAt: String(row.started_at),
    ...(typeof row.command_text === "string" ? { commandText: row.command_text } : {}),
    ...(typeof row.finished_at === "string" ? { finishedAt: row.finished_at } : {}),
    ...(typeof row.output_snippet === "string" ? { outputSnippet: row.output_snippet } : {}),
    ...(typeof row.request_json === "string"
      ? { request: parseJsonColumn<Record<string, unknown>>(row.request_json, {}) }
      : {}),
    ...(typeof row.response_json === "string"
      ? { response: parseJsonColumn<Record<string, unknown>>(row.response_json, {}) }
      : {}),
  };
}

export async function createRemediationRun(input: {
  actionType: string;
  commandText?: string;
  incidentId: string;
  provider: string;
  request?: Record<string, unknown>;
  serverId: string;
}): Promise<RemediationRunRecord> {
  const db = getDbClient();
  const id = randomUUID();
  const startedAt = new Date().toISOString();

  await db.execute({
    sql: `
      INSERT INTO remediation_runs (
        id,
        incident_id,
        server_id,
        action_type,
        provider,
        status,
        command_text,
        request_json,
        started_at
      )
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
    `,
    args: [
      id,
      input.incidentId,
      input.serverId,
      input.actionType,
      input.provider,
      input.commandText ?? null,
      input.request ? serializeJsonColumn(input.request) : null,
      startedAt,
    ],
  } satisfies InStatement);

  return {
    id,
    incidentId: input.incidentId,
    serverId: input.serverId,
    actionType: input.actionType,
    provider: input.provider,
    status: "running",
    startedAt,
    ...(input.commandText ? { commandText: input.commandText } : {}),
    ...(input.request ? { request: input.request } : {}),
  };
}

export async function completeRemediationRun(input: {
  id: string;
  outputSnippet: string;
  response?: Record<string, unknown>;
  status: "succeeded" | "failed";
}): Promise<void> {
  const db = getDbClient();
  await db.execute({
    sql: `
      UPDATE remediation_runs
      SET status = ?,
          output_snippet = ?,
          response_json = ?,
          finished_at = ?
      WHERE id = ?
    `,
    args: [
      input.status,
      input.outputSnippet,
      input.response ? serializeJsonColumn(input.response) : null,
      new Date().toISOString(),
      input.id,
    ],
  });
}

export async function listRemediationRunsByServerId(
  serverId: string,
  limit = 20,
  offset = 0,
): Promise<RemediationRunRecord[]> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT
        id,
        incident_id,
        server_id,
        action_type,
        provider,
        status,
        command_text,
        request_json,
        response_json,
        output_snippet,
        started_at,
        finished_at
      FROM remediation_runs
      WHERE server_id = ?
      ORDER BY started_at DESC
      LIMIT ?
      OFFSET ?
    `,
    args: [serverId, limit, offset],
  });

  return result.rows.map((row) => mapRemediationRunRow(row as Record<string, unknown>));
}

export async function countRemediationRunsByServerId(serverId: string): Promise<number> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT COUNT(*) AS total
      FROM remediation_runs
      WHERE server_id = ?
    `,
    args: [serverId],
  });

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row.total ?? 0) : 0;
}
