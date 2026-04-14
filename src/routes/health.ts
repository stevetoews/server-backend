import { verifyDatabaseConnection } from "../db/client.js";
import { verifySchemaReady } from "../db/migrations.js";
import { createErrorResponse, createJsonResponse, type AppRoute } from "../lib/http.js";

export const healthRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/health$/,
    handler: async () => {
      try {
        await verifyDatabaseConnection();
        const schemaReady = await verifySchemaReady();

        if (!schemaReady) {
          return createErrorResponse(503, {
            code: "SCHEMA_NOT_READY",
            message: "Database connection succeeded but the required schema is missing",
          });
        }

        return createJsonResponse(200, {
          ok: true,
          service: "server-agent-backend",
          checks: {
            api: "healthy",
            database: "healthy",
            schema: "healthy",
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
