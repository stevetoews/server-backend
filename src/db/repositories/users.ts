import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import type { InStatement } from "@libsql/client";

import { env } from "../../config/env.js";
import { getDbClient } from "../client.js";

export interface AuthUser {
  email: string;
  id: string;
  role: string;
}

interface UserRow {
  email: string;
  id: string;
  password_hash: string;
  role: string;
}

function createPasswordHash(password: string): string {
  const salt = randomUUID();
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");

  if (!salt || !hash) {
    return false;
  }

  const calculated = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");

  if (stored.length !== calculated.length) {
    return false;
  }

  return timingSafeEqual(stored, calculated);
}

function mapAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
  };
}

export async function ensureBootstrapAdmin(): Promise<AuthUser> {
  const db = getDbClient();
  const existing = await db.execute({
    sql: `
      SELECT id, email, password_hash, role
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    args: [env.BOOTSTRAP_ADMIN_EMAIL],
  });

  const row = existing.rows[0] as UserRow | undefined;

  if (row) {
    return mapAuthUser(row);
  }

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const passwordHash = createPasswordHash(env.BOOTSTRAP_ADMIN_PASSWORD);

  await db.execute({
    sql: `
      INSERT INTO users (
        id,
        email,
        password_hash,
        role,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [id, env.BOOTSTRAP_ADMIN_EMAIL, passwordHash, "admin", timestamp, timestamp],
  } satisfies InStatement);

  return {
    id,
    email: env.BOOTSTRAP_ADMIN_EMAIL,
    role: "admin",
  };
}

export async function authenticateUser(input: {
  email: string;
  password: string;
}): Promise<AuthUser | null> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT id, email, password_hash, role
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    args: [input.email],
  });

  const row = result.rows[0] as UserRow | undefined;

  if (!row || !verifyPassword(input.password, row.password_hash)) {
    return null;
  }

  return mapAuthUser(row);
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT id, email, password_hash, role
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    args: [id],
  });

  const row = result.rows[0] as UserRow | undefined;
  return row ? mapAuthUser(row) : null;
}
