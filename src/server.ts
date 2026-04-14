import { randomUUID } from "node:crypto";
import http from "node:http";

import { env } from "./config/env.js";
import {
  type AppRoute,
  createJsonResponse,
  createNotFoundResponse,
  type RequestContext,
  sendResponse,
} from "./lib/http.js";
import { healthRoutes } from "./routes/health.js";
import { integrationRoutes } from "./routes/integrations.js";
import { serverRoutes } from "./routes/servers.js";

const routes: AppRoute[] = [
  ...healthRoutes,
  ...serverRoutes,
  ...integrationRoutes,
];

const server = http.createServer(async (req, res) => {
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

  sendResponse(res, response);
});

server.listen(env.PORT, () => {
  const payload = createJsonResponse(200, {
    ok: true,
    message: "Server maintenance backend listening",
    port: env.PORT,
    environment: env.NODE_ENV,
  });

  // Keep startup logging structured for Render and local process managers.
  console.log(JSON.stringify(payload.body));
});
