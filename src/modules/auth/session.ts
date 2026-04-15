import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../../config/env.js";

const SESSION_COOKIE_NAME = "server_agent_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function getCookieBaseAttributes(): string[] {
  const attributes = ["Path=/", "HttpOnly"];

  if (env.NODE_ENV === "production") {
    attributes.push("SameSite=None", "Secure");
    return attributes;
  }

  attributes.push("SameSite=Lax");
  return attributes;
}

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("hex");
}

export interface SessionInfo {
  expiresAt: string;
  issuedAt: string;
  userId: string;
}

export function createSessionCookie(userId: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${userId}.${issuedAt}`;
  const signature = sign(payload);
  const value = `${payload}.${signature}`;
  const attributes = [...getCookieBaseAttributes(), `Max-Age=${SESSION_TTL_SECONDS}`];

  return `${SESSION_COOKIE_NAME}=${value}; ${attributes.join("; ")}`;
}

export function createExpiredSessionCookie(): string {
  const attributes = [...getCookieBaseAttributes(), "Max-Age=0"];

  return `${SESSION_COOKIE_NAME}=; ${attributes.join("; ")}`;
}

export function readSessionUserId(cookieHeader: string | undefined): string | null {
  return readSessionInfo(cookieHeader)?.userId ?? null;
}

export function readSessionInfo(cookieHeader: string | undefined): SessionInfo | null {
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

  if (age < 0 || age > SESSION_TTL_SECONDS) {
    return null;
  }

  return {
    userId,
    issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
    expiresAt: new Date((issuedAtSeconds + SESSION_TTL_SECONDS) * 1000).toISOString(),
  };
}
