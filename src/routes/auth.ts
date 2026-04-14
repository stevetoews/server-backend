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
  type AppRoute,
} from "../lib/http.js";
import {
  createExpiredSessionCookie,
  createSessionCookie,
  readSessionUserId,
} from "../modules/auth/session.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRoutes: AppRoute[] = [
  {
    method: "POST",
    pattern: /^\/auth\/login$/,
    handler: async (context) => {
      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = loginSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const user = await authenticateUser(parsed.data);

      if (!user) {
        return createErrorResponse(401, {
          code: "INVALID_CREDENTIALS",
          message: "Email or password was invalid",
          requestId: context.requestId,
        });
      }

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

      if (!userId) {
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
