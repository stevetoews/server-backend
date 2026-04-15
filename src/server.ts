import { randomUUID } from "node:crypto";
import http from "node:http";

import { env } from "./config/env.js";
import { runMigrations } from "./db/migrations.js";
import {
  type AppRoute,
  createErrorResponse,
  createJsonResponse,
  createNotFoundResponse,
  type RequestContext,
  sendResponse,
} from "./lib/http.js";
import { getUserById } from "./db/repositories/users.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { activityRoutes } from "./routes/activity.js";
import { checkRoutes } from "./routes/checks.js";
import { incidentRoutes } from "./routes/incidents.js";
import { integrationRoutes } from "./routes/integrations.js";
import { notificationRoutes } from "./routes/notifications.js";
import { serverRoutes } from "./routes/servers.js";
import { ensureBootstrapAdmin } from "./db/repositories/users.js";
import { ensureNotificationTarget } from "./db/repositories/notification-targets.js";
import { readSessionUserId } from "./modules/auth/session.js";
import { startCheckScheduler } from "./modules/checks/scheduler.js";

const deployedFrontendOrigins = new Set([
  "https://server-frontend-beige.vercel.app",
]);

function buildCorsHeaders(origin?: string) {
  const allowedOrigin =
    origin && allowedOrigins.has(origin)
      ? origin
      : env.FRONTEND_BASE_URL;

  return {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-origin": allowedOrigin,
  vary: "Origin",
  } as const;
}

const publicRoutes: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/health$/ },
  { method: "POST", pattern: /^\/auth\/login$/ },
  { method: "POST", pattern: /^\/auth\/logout$/ },
];

const allowedOrigins = new Set([
  new URL(env.FRONTEND_BASE_URL).origin,
  new URL(env.APP_BASE_URL).origin,
  ...deployedFrontendOrigins,
]);

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isPublicRoute(method: string, pathname: string): boolean {
  return publicRoutes.some((route) => route.method === method && route.pattern.test(pathname));
}

function isUnsafeMethod(method: string | undefined): boolean {
  return Boolean(method && unsafeMethods.has(method));
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  return allowedOrigins.has(origin);
}

async function requireAuthenticatedAdmin(context: RequestContext) {
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

  if (user.role !== "admin") {
    return createErrorResponse(403, {
      code: "FORBIDDEN",
      message: "Admin access is required",
      requestId: context.requestId,
    });
  }

  return null;
}

const routes: AppRoute[] = [
  ...healthRoutes,
  ...authRoutes,
  ...activityRoutes,
  ...checkRoutes,
  ...incidentRoutes,
  ...serverRoutes,
  ...integrationRoutes,
  ...notificationRoutes,
];

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendResponse(
      res,
      createJsonResponse(204, { ok: true }, { ...buildCorsHeaders(req.headers.origin) }),
    );
    return;
  }

  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const context: RequestContext = {
    req,
    requestId: randomUUID(),
    url: requestUrl,
  };

  const matchedRoute = routes.find((route) => {
    if (route.method !== req.method) {
      return false;
    }

    return route.pattern.test(requestUrl.pathname);
  });

  if (matchedRoute && isUnsafeMethod(req.method) && !isAllowedOrigin(req.headers.origin)) {
    const originError = createErrorResponse(403, {
      code: "INVALID_ORIGIN",
      message: "Requests must originate from the configured frontend",
      requestId: context.requestId,
    });

    sendResponse(res, {
      ...originError,
      headers: {
        ...buildCorsHeaders(req.headers.origin),
        ...originError.headers,
      },
    });
    return;
  }

  if (matchedRoute && !isPublicRoute(req.method ?? "GET", requestUrl.pathname)) {
    const authResponse = await requireAuthenticatedAdmin(context);

    if (authResponse) {
      sendResponse(
        res,
        {
          ...authResponse,
          headers: {
            ...buildCorsHeaders(req.headers.origin),
            ...authResponse.headers,
          },
        },
      );
      return;
    }
  }

  const response = matchedRoute
    ? await matchedRoute.handler(context)
    : createNotFoundResponse({
        code: "ROUTE_NOT_FOUND",
        message: `No route matches ${req.method ?? "UNKNOWN"} ${requestUrl.pathname}`,
      });

  sendResponse(res, {
    ...response,
    headers: {
      ...buildCorsHeaders(req.headers.origin),
      ...response.headers,
    },
  });
});

async function bootstrap(): Promise<void> {
  const appliedMigrations = await runMigrations();
  const bootstrapAdmin = await ensureBootstrapAdmin();
  const bootstrapNotificationTarget = await ensureNotificationTarget({
    channel: "email",
    label: "Bootstrap Admin",
    address: bootstrapAdmin.email,
  });
  startCheckScheduler();

  server.listen(env.PORT, () => {
    const payload = createJsonResponse(200, {
      ok: true,
      message: "Server maintenance backend listening",
      port: env.PORT,
      environment: env.NODE_ENV,
      appliedMigrations,
      bootstrapAdminEmail: bootstrapAdmin.email,
      bootstrapNotificationTargetId: bootstrapNotificationTarget.id,
    });

    // Keep startup logging structured for Render and local process managers.
    console.log(JSON.stringify(payload.body));
  });
}

await bootstrap();
