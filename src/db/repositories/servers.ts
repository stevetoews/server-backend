import type { InStatement } from "@libsql/client";

import type {
  IntegrationKind,
  ProviderMatch,
  ServerDraftInput,
  ServerRecord,
} from "../../modules/contracts/server.js";
import { getDbClient } from "../client.js";
import { parseJsonColumn, serializeJsonColumn, toNullableString } from "../sql.js";

export interface ServerRuntimeRecord extends ServerRecord {
  encryptedSshPassword?: string;
}

function mapServerRow(row: Record<string, unknown>): ServerRecord {
  const reasons = parseJsonColumn<string[]>(row.provider_match_reasons_json, []);
  const providerKind = toNullableString(row.provider_kind);
  const providerInstanceId = toNullableString(row.provider_instance_id);
  const providerMatch =
    providerKind && providerInstanceId
      ? ({
          providerKind: providerKind as Extract<IntegrationKind, "linode" | "digitalocean">,
          providerInstanceId,
          confidence:
            typeof row.provider_match_confidence === "number"
              ? row.provider_match_confidence
              : Number(row.provider_match_confidence ?? 0),
          reasons: reasons.length > 0 ? reasons : ["Persisted provider match"],
        } satisfies ProviderMatch)
      : undefined;

  return {
    id: String(row.id),
    name: String(row.name),
    environment: String(row.environment) as ServerRecord["environment"],
    hostname: String(row.hostname),
    sshPort:
      typeof row.ssh_port === "number" ? row.ssh_port : Number(row.ssh_port),
    sshUsername: String(row.ssh_username),
    sshAuthMode: String(row.ssh_auth_mode) as ServerRecord["sshAuthMode"],
    onboardingStatus: String(
      row.onboarding_status,
    ) as ServerRecord["onboardingStatus"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(toNullableString(row.os_name) ? { osName: String(row.os_name) } : {}),
    ...(toNullableString(row.os_version) ? { osVersion: String(row.os_version) } : {}),
    ...(toNullableString(row.ip_address)
      ? { ipAddress: String(row.ip_address) }
      : {}),
    ...(toNullableString(row.notes) ? { notes: String(row.notes) } : {}),
    ...(toNullableString(row.spinupwp_server_id)
      ? { spinupwpServerId: String(row.spinupwp_server_id) }
      : {}),
    ...(providerMatch ? { providerMatch } : {}),
  };
}

function mapServerRuntimeRow(row: Record<string, unknown>): ServerRuntimeRecord {
  return {
    ...mapServerRow(row),
    ...(toNullableString(row.encrypted_ssh_password)
      ? { encryptedSshPassword: String(row.encrypted_ssh_password) }
      : {}),
  };
}

export async function listServers(): Promise<ServerRecord[]> {
  const db = getDbClient();
  const result = await db.execute(`
    SELECT
      id,
      name,
      environment,
      hostname,
      ip_address,
      ssh_port,
      ssh_username,
      ssh_auth_mode,
      onboarding_status,
      os_name,
      os_version,
      provider_kind,
      provider_instance_id,
      provider_match_confidence,
      provider_match_reasons_json,
      spinupwp_server_id,
      notes,
      created_at,
      updated_at
    FROM servers
    ORDER BY created_at DESC
  `);

  return result.rows.map((row) => mapServerRow(row as Record<string, unknown>));
}

export async function listActiveMonitoredServers(): Promise<ServerRecord[]> {
  const db = getDbClient();
  const result = await db.execute(`
    SELECT
      id,
      name,
      environment,
      hostname,
      ip_address,
      ssh_port,
      ssh_username,
      ssh_auth_mode,
      onboarding_status,
      os_name,
      os_version,
      provider_kind,
      provider_instance_id,
      provider_match_confidence,
      provider_match_reasons_json,
      spinupwp_server_id,
      notes,
      created_at,
      updated_at
    FROM servers
    WHERE onboarding_status = 'active'
      AND monitoring_enabled = 1
    ORDER BY updated_at DESC
  `);

  return result.rows.map((row) => mapServerRow(row as Record<string, unknown>));
}

export async function listActiveMonitoredServerRuntimeRecords(): Promise<ServerRuntimeRecord[]> {
  const db = getDbClient();
  const result = await db.execute(`
    SELECT
      id,
      name,
      environment,
      hostname,
      ip_address,
      ssh_port,
      ssh_username,
      ssh_auth_mode,
      encrypted_ssh_password,
      onboarding_status,
      os_name,
      os_version,
      provider_kind,
      provider_instance_id,
      provider_match_confidence,
      provider_match_reasons_json,
      spinupwp_server_id,
      notes,
      created_at,
      updated_at
    FROM servers
    WHERE onboarding_status = 'active'
      AND monitoring_enabled = 1
    ORDER BY updated_at DESC
  `);

  return result.rows.map((row) => mapServerRuntimeRow(row as Record<string, unknown>));
}

export async function createServerDraft(input: {
  draft: ServerDraftInput;
  encryptedSshPassword?: string;
  id: string;
  onboardingStatus: ServerRecord["onboardingStatus"];
  osName?: string;
  osVersion?: string;
  providerMatch?: ProviderMatch;
  timestamp: string;
}): Promise<ServerRecord> {
  const db = getDbClient();

  const statement = {
    sql: `
      INSERT INTO servers (
        id,
        name,
        environment,
        hostname,
        ip_address,
        ssh_port,
        ssh_username,
        ssh_auth_mode,
        encrypted_ssh_password,
        onboarding_status,
        os_name,
        os_version,
        provider_kind,
        provider_instance_id,
        provider_match_confidence,
        provider_match_reasons_json,
        notes,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      input.id,
      input.draft.name,
      input.draft.environment,
      input.draft.hostname,
      input.draft.ipAddress ?? null,
      input.draft.sshPort,
      input.draft.sshUsername,
      input.draft.sshAuthMode,
      input.encryptedSshPassword ?? null,
      input.onboardingStatus,
      input.osName ?? null,
      input.osVersion ?? null,
      input.providerMatch?.providerKind ?? null,
      input.providerMatch?.providerInstanceId ?? null,
      input.providerMatch?.confidence ?? null,
      input.providerMatch
        ? serializeJsonColumn(input.providerMatch.reasons)
        : null,
      input.draft.notes ?? null,
      input.timestamp,
      input.timestamp,
    ],
  } satisfies InStatement;

  await db.execute(statement);

  return {
    id: input.id,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    onboardingStatus: input.onboardingStatus,
    ...input.draft,
    ...(input.osName ? { osName: input.osName } : {}),
    ...(input.osVersion ? { osVersion: input.osVersion } : {}),
    ...(input.providerMatch ? { providerMatch: input.providerMatch } : {}),
  };
}

export async function getServerById(id: string): Promise<ServerRecord | null> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT
        id,
        name,
        environment,
        hostname,
        ip_address,
        ssh_port,
        ssh_username,
        ssh_auth_mode,
        onboarding_status,
        os_name,
        os_version,
        provider_kind,
        provider_instance_id,
        provider_match_confidence,
        provider_match_reasons_json,
        spinupwp_server_id,
        notes,
        created_at,
        updated_at
      FROM servers
      WHERE id = ?
      LIMIT 1
    `,
    args: [id],
  });

  const row = result.rows[0];
  return row ? mapServerRow(row as Record<string, unknown>) : null;
}

export async function getServerRuntimeById(id: string): Promise<ServerRuntimeRecord | null> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT
        id,
        name,
        environment,
        hostname,
        ip_address,
        ssh_port,
        ssh_username,
        ssh_auth_mode,
        encrypted_ssh_password,
        onboarding_status,
        provider_kind,
        provider_instance_id,
        provider_match_confidence,
        provider_match_reasons_json,
        os_name,
        os_version,
        spinupwp_server_id,
        notes,
        created_at,
        updated_at
      FROM servers
      WHERE id = ?
      LIMIT 1
    `,
    args: [id],
  });

  const row = result.rows[0];
  return row ? mapServerRuntimeRow(row as Record<string, unknown>) : null;
}

export async function confirmProviderMatch(input: {
  serverId: string;
  providerMatch: ProviderMatch;
  onboardingStatus: ServerRecord["onboardingStatus"];
  timestamp: string;
}): Promise<ServerRecord | null> {
  const db = getDbClient();

  await db.execute({
    sql: `
      UPDATE servers
      SET provider_kind = ?,
          provider_instance_id = ?,
          provider_match_confidence = ?,
          provider_match_reasons_json = ?,
          onboarding_status = ?,
          updated_at = ?
      WHERE id = ?
    `,
    args: [
      input.providerMatch.providerKind,
      input.providerMatch.providerInstanceId,
      input.providerMatch.confidence,
      serializeJsonColumn(input.providerMatch.reasons),
      input.onboardingStatus,
      input.timestamp,
      input.serverId,
    ],
  });

  return getServerById(input.serverId);
}

export async function mapSpinupwpServer(input: {
  serverId: string;
  spinupwpServerId: string;
  timestamp: string;
}): Promise<ServerRecord | null> {
  const db = getDbClient();

  await db.execute({
    sql: `
      UPDATE servers
      SET spinupwp_server_id = ?,
          updated_at = ?
      WHERE id = ?
    `,
    args: [input.spinupwpServerId, input.timestamp, input.serverId],
  });

  return getServerById(input.serverId);
}
