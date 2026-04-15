import { countAuditLogs, listAuditLogs } from "../db/repositories/audit.js";
import { countIncidentsByServerId, listIncidentsByServerId } from "../db/repositories/incidents.js";
import {
  countNotificationDeliveries,
  listNotificationDeliveries,
} from "../db/repositories/notification-deliveries.js";
import {
  countRemediationRunsByServerId,
  listRemediationRunsByServerId,
} from "../db/repositories/remediation-runs.js";
import { getServerById } from "../db/repositories/servers.js";
import { createJsonResponse, type AppRoute } from "../lib/http.js";
import { paginateOffsetQuery, paginateWindow, parseBoundedInt } from "../lib/pagination.js";

export const activityRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/audit\/logs$/,
    handler: async (context) => {
      const limit = parseBoundedInt(context.url.searchParams.get("limit"), 50, 1, 100);
      const offset = parseBoundedInt(context.url.searchParams.get("offset"), 0, 0, 10_000);
      const targetType = context.url.searchParams.get("targetType") ?? undefined;
      const targetId = context.url.searchParams.get("targetId") ?? undefined;
      const [logs, total] = await Promise.all([
        listAuditLogs({
          limit: limit + 1,
          offset,
          ...(targetType ? { targetType } : {}),
          ...(targetId ? { targetId } : {}),
        }),
        countAuditLogs({
          ...(targetType ? { targetType } : {}),
          ...(targetId ? { targetId } : {}),
        }),
      ]);

      const page = paginateOffsetQuery(logs, limit, offset, total);

      return createJsonResponse(200, {
        ok: true,
        data: {
          logs: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/activity$/,
    handler: async (context) => {
      const limit = parseBoundedInt(context.url.searchParams.get("limit"), 50, 1, 100);
      const offset = parseBoundedInt(context.url.searchParams.get("offset"), 0, 0, 10_000);
      const kind = context.url.searchParams.get("kind");
      const eventType = context.url.searchParams.get("eventType") ?? undefined;
      const [auditTotal, deliveryTotal] = await Promise.all([
        countAuditLogs(),
        countNotificationDeliveries(eventType ? { eventType } : undefined),
      ]);
      const [logs, deliveries] = await Promise.all([
        listAuditLogs({ limit: auditTotal, offset: 0 }),
        listNotificationDeliveries({
          limit: deliveryTotal,
          offset: 0,
          ...(eventType ? { eventType } : {}),
        }),
      ]);

      let items = [
        ...logs.map((log) => ({
          id: `audit:${log.id}`,
          createdAt: log.createdAt,
          kind: "audit" as const,
          payload: log,
        })),
        ...deliveries.map((delivery) => ({
          id: `notification:${delivery.id}`,
          createdAt: delivery.createdAt,
          kind: "notification" as const,
          payload: delivery,
        })),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

      if (kind === "audit" || kind === "notification") {
        items = items.filter((item) => item.kind === kind);
      }

      const page = paginateWindow(items, limit, offset, items.length);

      return createJsonResponse(200, {
        ok: true,
        data: {
          items: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+\/activity$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];
      const limit = parseBoundedInt(context.url.searchParams.get("limit"), 50, 1, 100);
      const offset = parseBoundedInt(context.url.searchParams.get("offset"), 0, 0, 10_000);
      const kind = context.url.searchParams.get("kind");
      const eventType = context.url.searchParams.get("eventType") ?? undefined;

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

      const server = await getServerById(serverId);

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

      const [serverAuditTotal, incidentTotal, remediationTotal] = await Promise.all([
        countAuditLogs({ targetType: "server", targetId: serverId }),
        countIncidentsByServerId(serverId),
        countRemediationRunsByServerId(serverId),
      ]);
      const [serverLogs, incidents, remediations] = await Promise.all([
        listAuditLogs({
          limit: serverAuditTotal,
          offset: 0,
          targetType: "server",
          targetId: serverId,
        }),
        listIncidentsByServerId(serverId, incidentTotal, 0),
        listRemediationRunsByServerId(serverId, remediationTotal, 0),
      ]);
      const incidentLogs = await Promise.all(
        incidents.map(async (incident) => {
          const total = await countAuditLogs({
            targetType: "incident",
            targetId: incident.id,
          });

          return listAuditLogs({
            limit: total,
            offset: 0,
            targetType: "incident",
            targetId: incident.id,
          });
        }),
      );

      let items = [
        ...serverLogs.map((log) => ({
          id: `audit:${log.id}`,
          createdAt: log.createdAt,
          kind: "audit" as const,
          payload: log,
        })),
        ...incidentLogs.flat().map((log) => ({
          id: `audit:${log.id}`,
          createdAt: log.createdAt,
          kind: "audit" as const,
          payload: log,
        })),
        ...incidents.map((incident) => ({
          id: `incident:${incident.id}`,
          createdAt: incident.openedAt,
          kind: "incident" as const,
          payload: incident,
        })),
        ...remediations.map((run) => ({
          id: `remediation:${run.id}`,
          createdAt: run.finishedAt ?? run.startedAt,
          kind: "remediation" as const,
          payload: run,
        })),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

      if (kind === "audit" || kind === "incident" || kind === "remediation") {
        items = items.filter((item) => item.kind === kind);
      }

      if (eventType) {
        items = items.filter((item) =>
          item.kind === "audit"
            ? item.payload.eventType === eventType
            : item.kind === "remediation"
              ? item.payload.actionType === eventType
              : item.kind === "incident"
                ? item.payload.checkType === eventType
                : true,
        );
      }

      const page = paginateWindow(items, limit, offset, items.length);

      return createJsonResponse(200, {
        ok: true,
        data: {
          server,
          items: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
];
