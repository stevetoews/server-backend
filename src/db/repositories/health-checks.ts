import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { getDbClient } from "../client.js";
import { parseJsonColumn, serializeJsonColumn } from "../sql.js";

export interface HealthCheckRecord {
  checkType: string;
  createdAt: string;
  id: string;
  latencyMs?: number;
  rawOutput?: Record<string, unknown>;
  serverId: string;
  status: "healthy" | "degraded" | "failed";
  summary: string;
}

function mapHealthCheckRow(row: Record<string, unknown>): HealthCheckRecord {
  return {
    id: String(row.id),
    serverId: String(row.server_id),
    checkType: String(row.check_type),
    status: String(row.status) as HealthCheckRecord["status"],
    summary: String(row.summary ?? ""),
    createdAt: String(row.created_at),
    ...(row.latency_ms !== null && row.latency_ms !== undefined
      ? {
          latencyMs:
            typeof row.latency_ms === "number"
              ? row.latency_ms
              : Number(row.latency_ms),
        }
      : {}),
    ...(typeof row.raw_output_json === "string" && row.raw_output_json.length > 0
      ? {
          rawOutput: parseJsonColumn<Record<string, unknown>>(row.raw_output_json, {}),
        }
      : {}),
  };
}

export async function insertHealthCheck(input: {
  checkType: string;
  latencyMs?: number;
  rawOutput?: Record<string, unknown>;
  serverId: string;
  status: HealthCheckRecord["status"];
  summary: string;
}): Promise<HealthCheckRecord> {
  const db = getDbClient();
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  await db.execute({
    sql: `
      INSERT INTO health_checks (
        id,
        server_id,
        check_type,
        status,
        latency_ms,
        summary,
        raw_output_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      input.serverId,
      input.checkType,
      input.status,
      input.latencyMs ?? null,
      input.summary,
      input.rawOutput ? serializeJsonColumn(input.rawOutput) : null,
      createdAt,
    ],
  } satisfies InStatement);

  return {
    id,
    serverId: input.serverId,
    checkType: input.checkType,
    status: input.status,
    summary: input.summary,
    createdAt,
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    ...(input.rawOutput ? { rawOutput: input.rawOutput } : {}),
  };
}

export async function listRecentHealthChecksByServerId(
  serverId: string,
  limit = 10,
  offset = 0,
): Promise<HealthCheckRecord[]> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT
        id,
        server_id,
        check_type,
        status,
        latency_ms,
        summary,
        raw_output_json,
        created_at
      FROM health_checks
      WHERE server_id = ?
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `,
    args: [serverId, limit, offset],
  });

  return result.rows.map((row) => mapHealthCheckRow(row as Record<string, unknown>));
}

export async function countHealthChecksByServerId(serverId: string): Promise<number> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT COUNT(*) AS total
      FROM health_checks
      WHERE server_id = ?
    `,
    args: [serverId],
  });

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row.total ?? 0) : 0;
}

export async function getLatestHealthCheckByServerAndType(input: {
  serverId: string;
  checkType: string;
}): Promise<HealthCheckRecord | null> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT
        id,
        server_id,
        check_type,
        status,
        latency_ms,
        summary,
        raw_output_json,
        created_at
      FROM health_checks
      WHERE server_id = ?
        AND check_type = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    args: [input.serverId, input.checkType],
  });

  const row = result.rows[0];
  return row ? mapHealthCheckRow(row as Record<string, unknown>) : null;
}
