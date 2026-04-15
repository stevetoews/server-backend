import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { getDbClient } from "../client.js";

export interface NotificationTargetRecord {
  address: string;
  channel: "email";
  createdAt: string;
  enabled: boolean;
  id: string;
  label: string;
  updatedAt: string;
}

export interface CreateNotificationTargetInput {
  address: string;
  channel: NotificationTargetRecord["channel"];
  enabled: boolean;
  label: string;
}

export interface UpdateNotificationTargetInput {
  address?: string;
  enabled?: boolean;
  id: string;
  label?: string;
}

function mapNotificationTargetRow(row: Record<string, unknown>): NotificationTargetRecord {
  const enabledValue =
    typeof row.enabled === "number" ? row.enabled : Number(row.enabled ?? 0);

  return {
    id: String(row.id),
    channel: String(row.channel) as NotificationTargetRecord["channel"],
    label: String(row.label),
    address: String(row.address),
    enabled: enabledValue === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listNotificationTargets(): Promise<NotificationTargetRecord[]> {
  const db = getDbClient();
  const result = await db.execute(`
    SELECT id, channel, label, address, enabled, created_at, updated_at
    FROM notification_targets
    ORDER BY created_at DESC
  `);

  return result.rows.map((row) => mapNotificationTargetRow(row as Record<string, unknown>));
}

export async function listNotificationTargetsWithQuery(input?: {
  channel?: NotificationTargetRecord["channel"];
  enabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<NotificationTargetRecord[]> {
  const db = getDbClient();
  const limit = input?.limit ?? 50;
  const offset = input?.offset ?? 0;
  const conditions: string[] = [];
  const args: Array<string | number> = [];

  if (input?.channel) {
    conditions.push("channel = ?");
    args.push(input.channel);
  }

  if (input?.enabled !== undefined) {
    conditions.push("enabled = ?");
    args.push(input.enabled ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.execute({
    sql: `
      SELECT id, channel, label, address, enabled, created_at, updated_at
      FROM notification_targets
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `,
    args: [...args, limit, offset],
  });

  return result.rows.map((row) => mapNotificationTargetRow(row as Record<string, unknown>));
}

export async function countNotificationTargetsWithQuery(input?: {
  channel?: NotificationTargetRecord["channel"];
  enabled?: boolean;
}): Promise<number> {
  const db = getDbClient();
  const conditions: string[] = [];
  const args: Array<string | number> = [];

  if (input?.channel) {
    conditions.push("channel = ?");
    args.push(input.channel);
  }

  if (input?.enabled !== undefined) {
    conditions.push("enabled = ?");
    args.push(input.enabled ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.execute({
    sql: `
      SELECT COUNT(*) AS total
      FROM notification_targets
      ${whereClause}
    `,
    args,
  });

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row.total ?? 0) : 0;
}

export async function listEnabledNotificationTargets(): Promise<NotificationTargetRecord[]> {
  const db = getDbClient();
  const result = await db.execute(`
    SELECT id, channel, label, address, enabled, created_at, updated_at
    FROM notification_targets
    WHERE enabled = 1
    ORDER BY created_at DESC
  `);

  return result.rows.map((row) => mapNotificationTargetRow(row as Record<string, unknown>));
}

export async function countEnabledNotificationTargets(): Promise<number> {
  const db = getDbClient();
  const result = await db.execute(`
    SELECT COUNT(*) AS enabled_count
    FROM notification_targets
    WHERE enabled = 1
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row.enabled_count ?? 0) : 0;
}

export async function getNotificationTargetById(
  id: string,
): Promise<NotificationTargetRecord | null> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT id, channel, label, address, enabled, created_at, updated_at
      FROM notification_targets
      WHERE id = ?
      LIMIT 1
    `,
    args: [id],
  });

  const row = result.rows[0];
  return row ? mapNotificationTargetRow(row as Record<string, unknown>) : null;
}

export async function createNotificationTarget(
  input: CreateNotificationTargetInput,
): Promise<NotificationTargetRecord> {
  const db = getDbClient();
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  await db.execute({
    sql: `
      INSERT INTO notification_targets (
        id,
        channel,
        label,
        address,
        enabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      input.channel,
      input.label,
      input.address,
      input.enabled ? 1 : 0,
      timestamp,
      timestamp,
    ],
  } satisfies InStatement);

  return {
    id,
    channel: input.channel,
    label: input.label,
    address: input.address,
    enabled: input.enabled,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function ensureNotificationTarget(input: {
  address: string;
  channel: NotificationTargetRecord["channel"];
  label: string;
}): Promise<NotificationTargetRecord> {
  const db = getDbClient();
  const existing = await db.execute({
    sql: `
      SELECT id, channel, label, address, enabled, created_at, updated_at
      FROM notification_targets
      WHERE channel = ?
        AND address = ?
      LIMIT 1
    `,
    args: [input.channel, input.address],
  });

  const row = existing.rows[0];

  if (row) {
    return mapNotificationTargetRow(row as Record<string, unknown>);
  }

  return createNotificationTarget({
    address: input.address,
    channel: input.channel,
    enabled: true,
    label: input.label,
  });
}

export async function updateNotificationTarget(
  input: UpdateNotificationTargetInput,
): Promise<NotificationTargetRecord | null> {
  const db = getDbClient();
  const current = await getNotificationTargetById(input.id);

  if (!current) {
    return null;
  }
  const timestamp = new Date().toISOString();

  const result = await db.execute({
    sql: `
      UPDATE notification_targets
      SET label = ?,
          address = ?,
          enabled = ?,
          updated_at = ?
      WHERE id = ?
        AND (
          ? = 0
          OR enabled = 0
          OR (SELECT COUNT(*) FROM notification_targets WHERE enabled = 1) > 1
        )
    `,
    args: [
      input.label ?? current.label,
      input.address ?? current.address,
      input.enabled === undefined ? (current.enabled ? 1 : 0) : input.enabled ? 1 : 0,
      timestamp,
      input.id,
      input.enabled === false ? 1 : 0,
    ],
  } satisfies InStatement);

  if (Number(result.rowsAffected ?? 0) === 0) {
    return null;
  }

  const updated = await getNotificationTargetById(input.id);
  return updated;
}

export async function deleteNotificationTarget(id: string): Promise<boolean> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      DELETE FROM notification_targets
      WHERE id = ?
        AND (
          (SELECT enabled FROM notification_targets WHERE id = ?) = 0
          OR (SELECT COUNT(*) FROM notification_targets WHERE enabled = 1) > 1
        )
    `,
    args: [id, id],
  });

  return Number(result.rowsAffected ?? 0) > 0;
}
