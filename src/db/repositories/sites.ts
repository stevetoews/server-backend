import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { getDbClient } from "../client.js";
import { toNullableString } from "../sql.js";

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }

  return undefined;
}

export interface SiteRecord {
  appType: string;
  cacheType?: string;
  createdAt: string;
  domain: string;
  id: string;
  phpVersion?: string;
  serverId: string;
  siteEnabled?: boolean;
  sitePath: string;
  sslEnabled?: boolean;
  updatedAt: string;
}

function mapSiteRow(row: Record<string, unknown>): SiteRecord {
  const siteEnabled = toOptionalBoolean(row.site_enabled);
  const sslEnabled = toOptionalBoolean(row.ssl_enabled);

  return {
    id: String(row.id),
    serverId: String(row.server_id),
    domain: String(row.domain),
    sitePath: String(row.site_path),
    appType: String(row.app_type),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(toNullableString(row.php_version) ? { phpVersion: String(row.php_version) } : {}),
    ...(toNullableString(row.cache_type) ? { cacheType: String(row.cache_type) } : {}),
    ...(siteEnabled !== undefined ? { siteEnabled } : {}),
    ...(sslEnabled !== undefined ? { sslEnabled } : {}),
  };
}

export async function listSitesByServerId(serverId: string): Promise<SiteRecord[]> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT
        id,
        server_id,
        domain,
        site_path,
        app_type,
        php_version,
        cache_type,
        ssl_enabled,
        site_enabled,
        created_at,
        updated_at
      FROM sites
      WHERE server_id = ?
      ORDER BY domain ASC
    `,
    args: [serverId],
  });

  return result.rows.map((row) => mapSiteRow(row as Record<string, unknown>));
}

export async function replaceSitesForServer(input: {
  serverId: string;
    sites: Array<{
      appType: string;
      cacheType?: string;
      domain: string;
      phpVersion?: string;
      siteEnabled?: boolean;
      sitePath: string;
      sslEnabled?: boolean;
    }>;
  timestamp: string;
}): Promise<SiteRecord[]> {
  const db = getDbClient();

  await db.execute({
    sql: "DELETE FROM sites WHERE server_id = ?",
    args: [input.serverId],
  });

  for (const site of input.sites) {
    await db.execute({
      sql: `
        INSERT INTO sites (
          id,
          server_id,
          domain,
          site_path,
          app_type,
          php_version,
          cache_type,
          ssl_enabled,
          site_enabled,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        randomUUID(),
        input.serverId,
        site.domain,
        site.sitePath,
        site.appType,
        site.phpVersion ?? null,
        site.cacheType ?? null,
        site.sslEnabled ?? null,
        site.siteEnabled ?? null,
        input.timestamp,
        input.timestamp,
      ],
    } satisfies InStatement);
  }

  return listSitesByServerId(input.serverId);
}
