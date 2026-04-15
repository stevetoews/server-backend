import { z } from "zod";

import {
  authenticateUser,
  getUserById,
} from "../db/repositories/users.js";
import {
  createErrorResponse,
  createJsonResponse,
  createValidationErrorResponse,
  readJsonBody,
  type RequestContext,
  type AppRoute,
} from "../lib/http.js";
import {
  createExpiredSessionCookie,
  createSessionCookie,
  readSessionInfo,
  readSessionUserId,
} from "../modules/auth/session.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

interface LoginAttemptBucket {
  attempts: number;
  blockedUntil?: number;
  firstAttemptAt: number;
}

const loginAttempts = new Map<string, LoginAttemptBucket>();

function getLoginThrottleKey(context: Pick<RequestContext, "req">): string {
  const forwardedFor = context.req.headers["x-forwarded-for"];
  const forwardedAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ipAddress = forwardedAddress?.split(",")[0]?.trim() || context.req.socket?.remoteAddress || "unknown";

  return ipAddress;
}

function recordFailedLoginAttempt(key: string): void {
  const now = Date.now();
  const bucket = loginAttempts.get(key);

  if (!bucket || now - bucket.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, {
      attempts: 1,
      firstAttemptAt: now,
    });
    return;
  }

  bucket.attempts += 1;

  if (bucket.attempts >= LOGIN_MAX_ATTEMPTS) {
    bucket.blockedUntil = now + LOGIN_WINDOW_MS;
  }
}

function isLoginRateLimited(key: string): boolean {
  const bucket = loginAttempts.get(key);

  if (!bucket) {
    return false;
  }

  const now = Date.now();

  if (bucket.blockedUntil && bucket.blockedUntil > now) {
    return true;
  }

  if (now - bucket.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }

  return false;
}

function clearLoginAttempts(key: string): void {
  loginAttempts.delete(key);
}

export const authRoutes: AppRoute[] = [
  {
    method: "POST",
    pattern: /^\/auth\/login$/,
    handler: async (context) => {
      const throttleKey = getLoginThrottleKey(context);

      if (isLoginRateLimited(throttleKey)) {
        return createErrorResponse(429, {
          code: "AUTH_RATE_LIMITED",
          message: "Too many login attempts. Try again later.",
          requestId: context.requestId,
        });
      }

      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = loginSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const user = await authenticateUser(parsed.data);

      if (!user) {
        recordFailedLoginAttempt(throttleKey);

        return createErrorResponse(401, {
          code: "INVALID_CREDENTIALS",
          message: "Email or password was invalid",
          requestId: context.requestId,
        });
      }

      clearLoginAttempts(throttleKey);

      return createJsonResponse(
        200,
        {
          ok: true,
          data: {
            user,
          },
        },
        {
          "set-cookie": createSessionCookie(user.id),
        },
      );
    },
  },
  {
    method: "GET",
    pattern: /^\/auth\/me$/,
    handler: async (context) => {
      const userId = readSessionUserId(context.req.headers.cookie);
      const session = readSessionInfo(context.req.headers.cookie);

      if (!userId || !session) {
        return createErrorResponse(401, {
          code: "UNAUTHENTICATED",
          message: "Authentication is required",
          requestId: context.requestId,
        });
      }

      const user = await getUserById(userId);

      if (!user) {
        return createErrorResponse(401, {
          code: "UNAUTHENTICATED",
          message: "Session was not valid",
          requestId: context.requestId,
        });
      }

      return createJsonResponse(200, {
        ok: true,
        data: {
          user,
          session,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/logout$/,
    handler: async () =>
      createJsonResponse(
        200,
        {
          ok: true,
        },
        {
          "set-cookie": createExpiredSessionCookie(),
        },
      ),
  },
];
