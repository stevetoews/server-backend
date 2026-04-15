import { randomUUID } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { getDbClient } from "../client.js";
import { toNullableString } from "../sql.js";

export interface SiteRecord {
  appType: string;
  cacheType?: string;
  createdAt: string;
  domain: string;
  id: string;
  phpVersion?: string;
  serverId: string;
  sitePath: string;
  updatedAt: string;
}

function mapSiteRow(row: Record<string, unknown>): SiteRecord {
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
    sitePath: string;
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
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        randomUUID(),
        input.serverId,
        site.domain,
        site.sitePath,
        site.appType,
        site.phpVersion ?? null,
        site.cacheType ?? null,
        input.timestamp,
        input.timestamp,
      ],
    } satisfies InStatement);
  }

  return listSitesByServerId(input.serverId);
}
