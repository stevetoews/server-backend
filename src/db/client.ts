import { createClient, type Client } from "@libsql/client";

import { env } from "../config/env.js";

let client: Client | undefined;

export function getDbClient(): Client {
  if (!client) {
    client = createClient({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });
  }

  return client;
}

export async function verifyDatabaseConnection(): Promise<boolean> {
  const db = getDbClient();
  await db.execute("select 1 as ok");
  return true;
}
