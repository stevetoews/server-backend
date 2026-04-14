import { verifyDatabaseConnection } from "../db/client.js";
import { createErrorResponse, createJsonResponse, type AppRoute } from "../lib/http.js";

export const healthRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/health$/,
    handler: async () => {
      try {
        await verifyDatabaseConnection();

        return createJsonResponse(200, {
          ok: true,
          service: "server-agent-backend",
          checks: {
            api: "healthy",
            database: "healthy",
          },
        });
      } catch (error) {
        return createErrorResponse(503, {
          code: "HEALTHCHECK_FAILED",
          message: "Database connectivity check failed",
          details: error instanceof Error ? { message: error.message } : error,
        });
      }
    },
  },
];
