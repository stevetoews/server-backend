import { z } from "zod";

import { countHealthChecksByServerId, listRecentHealthChecksByServerId } from "../db/repositories/health-checks.js";
import { getServerById } from "../db/repositories/servers.js";
import { createJsonResponse, createValidationErrorResponse, readJsonBody, type AppRoute } from "../lib/http.js";
import { paginateOffsetQuery, parseBoundedInt } from "../lib/pagination.js";
import { runChecksForAllActiveServers, runChecksForServer } from "../modules/checks/service.js";

const runChecksSchema = z.object({
  serverId: z.string().min(1).optional(),
});

export const checkRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+\/checks$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];
      const limit = parseBoundedInt(context.url.searchParams.get("limit"), 12, 1, 100);
      const offset = parseBoundedInt(context.url.searchParams.get("offset"), 0, 0, 10_000);

      if (!serverId) {
        return createJsonResponse(400, {
          ok: false,
          error: {
            code: "INVALID_SERVER_ID",
            message: "Server id is required in the request path",
            requestId: context.requestId,
          },
        });
      }

      const [checks, total] = await Promise.all([
        listRecentHealthChecksByServerId(serverId, limit + 1, offset),
        countHealthChecksByServerId(serverId),
      ]);
      const page = paginateOffsetQuery(checks, limit, offset, total);

      return createJsonResponse(200, {
        ok: true,
        data: {
          checks: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/checks\/run$/,
    handler: async (context) => {
      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = runChecksSchema.safeParse(rawBody ?? {});

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      if (parsed.data.serverId) {
        const server = await getServerById(parsed.data.serverId);

        if (!server) {
          return createJsonResponse(404, {
            ok: false,
            error: {
              code: "SERVER_NOT_FOUND",
              message: "Server record was not found",
              requestId: context.requestId,
            },
          });
        }

        const checks = await runChecksForServer(server);

        return createJsonResponse(200, {
          ok: true,
          data: {
            checks,
          },
        });
      }

      const summary = await runChecksForAllActiveServers();

      return createJsonResponse(200, {
        ok: true,
        data: {
          summary,
        },
      });
    },
  },
];
