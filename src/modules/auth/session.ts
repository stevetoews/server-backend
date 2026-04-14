import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../../config/env.js";

const SESSION_COOKIE_NAME = "server_agent_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("hex");
}

export function createSessionCookie(userId: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${userId}.${issuedAt}`;
  const signature = sign(payload);
  const value = `${payload}.${signature}`;

  return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function createExpiredSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSessionUserId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = Object.fromEntries(
    cookieHeader
      .split(/;\s*/g)
      .map((part) => {
        const [name, ...valueParts] = part.split("=");
        return [name, valueParts.join("=")];
      })
      .filter(([name]) => Boolean(name)),
  );

  const raw = cookies[SESSION_COOKIE_NAME];

  if (!raw) {
    return null;
  }

  const [userId, issuedAt, signature] = raw.split(".");

  if (!userId || !issuedAt || !signature) {
    return null;
  }

  const payload = `${userId}.${issuedAt}`;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (actualBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  const issuedAtSeconds = Number(issuedAt);

  if (!Number.isFinite(issuedAtSeconds)) {
    return null;
  }

  const age = Math.floor(Date.now() / 1000) - issuedAtSeconds;

  if (age > SESSION_TTL_SECONDS) {
    return null;
  }

  return userId;
}
