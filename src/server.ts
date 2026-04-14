import { randomUUID } from "node:crypto";
import http from "node:http";

import { env } from "./config/env.js";
import { runMigrations } from "./db/migrations.js";
import {
  type AppRoute,
  createJsonResponse,
  createNotFoundResponse,
  type RequestContext,
  sendResponse,
} from "./lib/http.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { checkRoutes } from "./routes/checks.js";
import { incidentRoutes } from "./routes/incidents.js";
import { integrationRoutes } from "./routes/integrations.js";
import { serverRoutes } from "./routes/servers.js";
import { ensureBootstrapAdmin } from "./db/repositories/users.js";

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-origin": env.FRONTEND_BASE_URL,
  vary: "Origin",
} as const;

const routes: AppRoute[] = [
  ...healthRoutes,
  ...authRoutes,
  ...checkRoutes,
  ...incidentRoutes,
  ...serverRoutes,
  ...integrationRoutes,
];

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendResponse(
      res,
      createJsonResponse(204, { ok: true }, { ...corsHeaders }),
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

  const response = matchedRoute
    ? await matchedRoute.handler(context)
    : createNotFoundResponse({
        code: "ROUTE_NOT_FOUND",
        message: `No route matches ${req.method ?? "UNKNOWN"} ${requestUrl.pathname}`,
      });

  sendResponse(res, {
    ...response,
    headers: {
      ...corsHeaders,
      ...response.headers,
    },
  });
});

async function bootstrap(): Promise<void> {
  const appliedMigrations = await runMigrations();
  const bootstrapAdmin = await ensureBootstrapAdmin();

  server.listen(env.PORT, () => {
    const payload = createJsonResponse(200, {
      ok: true,
      message: "Server maintenance backend listening",
      port: env.PORT,
      environment: env.NODE_ENV,
      appliedMigrations,
      bootstrapAdminEmail: bootstrapAdmin.email,
    });

    // Keep startup logging structured for Render and local process managers.
    console.log(JSON.stringify(payload.body));
  });
}

await bootstrap();
