import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import type { IntegrationKind } from "../../modules/contracts/server.js";
import { getDbClient } from "../client.js";
import { parseJsonColumn, serializeJsonColumn } from "../sql.js";

export interface IntegrationRecord {
  createdAt: string;
  enabled: boolean;
  id: string;
  kind: IntegrationKind;
  label: string;
  updatedAt: string;
}

export interface CreateIntegrationInput {
  enabled: boolean;
  kind: IntegrationKind;
  label: string;
}

function mapIntegrationRow(row: Record<string, unknown>): IntegrationRecord {
  const metadata = parseJsonColumn<{ enabled?: boolean }>(row.metadata_json, {});

  return {
    id: String(row.id),
    kind: String(row.provider) as IntegrationKind,
    label: String(row.name),
    enabled: metadata.enabled ?? true,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listIntegrations(): Promise<IntegrationRecord[]> {
  const db = getDbClient();
  const result = await db.execute(`
    SELECT id, provider, name, metadata_json, created_at, updated_at
    FROM integrations
    ORDER BY created_at DESC
  `);

  return result.rows.map((row) =>
    mapIntegrationRow(row as Record<string, unknown>),
  );
}

export async function createIntegration(
  input: CreateIntegrationInput,
): Promise<IntegrationRecord> {
  const db = getDbClient();
  const timestamp = new Date().toISOString();
  const id = randomUUID();

  await db.execute({
    sql: `
      INSERT INTO integrations (
        id,
        provider,
        name,
        encrypted_secret,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      input.kind,
      input.label,
      "__pending_secret__",
      serializeJsonColumn({ enabled: input.enabled }),
      timestamp,
      timestamp,
    ],
  } satisfies InStatement);

  return {
    id,
    kind: input.kind,
    label: input.label,
    enabled: input.enabled,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
