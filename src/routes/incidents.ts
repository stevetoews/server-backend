import { z } from "zod";

import {
  closeIncident,
  type IncidentRecord,
  countIncidents,
  countIncidentsByServerId,
  getIncidentById,
  listIncidents,
  listIncidentsByServerId,
  markIncidentRemediationPending,
} from "../db/repositories/incidents.js";
import {
  completeRemediationRun,
  createRemediationRun,
  countRemediationRunsByServerId,
  countRemediationRunsByIncidentId,
  listRemediationRunsByServerId,
  listRemediationRunsByIncidentId,
} from "../db/repositories/remediation-runs.js";
import { getServerById } from "../db/repositories/servers.js";
import { createJsonResponse, type AppRoute } from "../lib/http.js";
import { createValidationErrorResponse, readJsonBody } from "../lib/http.js";
import { paginateOffsetQuery, parseBoundedInt } from "../lib/pagination.js";
import { countAuditLogs, listAuditLogs } from "../db/repositories/audit.js";
import { writeAuditEvent } from "../modules/audit/logger.js";
import {
  getRemediationActionByType,
  getRemediationActionsForCheckType,
  type RemediationActionDefinition,
} from "../modules/remediation/catalog.js";
import { evaluateRemediationPolicy } from "../modules/policies/engine.js";
import { executeRemediation } from "../modules/remediation/service.js";
import { notifyEvent } from "../modules/notifications/service.js";

const remediationSchema = z.object({
  actionType: z.string().min(1),
});

interface IncidentRemediationAction {
  actionType: string;
  provider: RemediationActionDefinition["provider"];
  title: string;
}

interface EnrichedIncidentRecord extends IncidentRecord {
  remediation: {
    allowedActions: IncidentRemediationAction[];
    reasons: string[];
  };
}

async function enrichIncident(incident: IncidentRecord): Promise<EnrichedIncidentRecord> {
  const server = await getServerById(incident.serverId);
  const actions = getRemediationActionsForCheckType(incident.checkType);

  if (!server) {
    return {
      ...incident,
      remediation: {
        allowedActions: [],
        reasons: ["Server record is unavailable for remediation policy evaluation"],
      },
    };
  }

  const decisions = actions.map((action) =>
    evaluateRemediationPolicy({
      action,
      incident,
      server,
    }),
  );

  return {
    ...incident,
    remediation: {
      allowedActions: actions
        .filter((action) =>
          decisions.some(
            (decision) =>
              decision.action === "allow" && decision.actionType === action.actionType,
          ),
        )
        .map((action) => ({
          actionType: action.actionType,
          provider: action.provider,
          title: action.title,
        })),
      reasons: Array.from(new Set(decisions.flatMap((decision) => decision.reasons))),
    },
  };
}

export const incidentRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/incidents\/[^/]+$/,
    handler: async (context) => {
      const incidentId = context.url.pathname.split("/")[2];

      if (!incidentId) {
        return createJsonResponse(400, {
          ok: false,
          error: {
            code: "INVALID_INCIDENT_ID",
            message: "Incident id is required in the request path",
            requestId: context.requestId,
          },
        });
      }

      const incident = await getIncidentById(incidentId);

      if (!incident) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "INCIDENT_NOT_FOUND",
            message: "Incident record was not found",
            requestId: context.requestId,
          },
        });
      }

      const server = await getServerById(incident.serverId);

      if (!server) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "SERVER_NOT_FOUND",
            message: "Server record was not found for this incident",
            requestId: context.requestId,
          },
        });
      }

      const [remediationCount, auditCount] = await Promise.all([
        countRemediationRunsByIncidentId(incident.id),
        countAuditLogs({ targetType: "incident", targetId: incident.id }),
      ]);
      const [remediations, audits] = await Promise.all([
        listRemediationRunsByIncidentId(incident.id, remediationCount, 0),
        listAuditLogs({ targetType: "incident", targetId: incident.id, limit: auditCount, offset: 0 }),
      ]);

      const enrichedIncident = await enrichIncident(incident);

      return createJsonResponse(200, {
        ok: true,
        data: {
          incident: enrichedIncident,
          server,
          audits,
          remediations,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/incidents$/,
    handler: async (context) => {
      const limit = parseBoundedInt(context.url.searchParams.get("limit"), 25, 1, 100);
      const offset = parseBoundedInt(context.url.searchParams.get("offset"), 0, 0, 10_000);
      const [incidents, total] = await Promise.all([
        listIncidents(limit + 1, offset),
        countIncidents(),
      ]);
      const enrichedIncidents = await Promise.all(incidents.map((incident) => enrichIncident(incident)));
      const page = paginateOffsetQuery(enrichedIncidents, limit, offset, total);

      return createJsonResponse(200, {
        ok: true,
        data: {
          incidents: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+\/incidents$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];
      const limit = parseBoundedInt(context.url.searchParams.get("limit"), 20, 1, 100);
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

      const [incidents, total] = await Promise.all([
        listIncidentsByServerId(serverId, limit + 1, offset),
        countIncidentsByServerId(serverId),
      ]);
      const enrichedIncidents = await Promise.all(incidents.map((incident) => enrichIncident(incident)));
      const page = paginateOffsetQuery(enrichedIncidents, limit, offset, total);

      return createJsonResponse(200, {
        ok: true,
        data: {
          incidents: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+\/remediations$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];
      const limit = parseBoundedInt(context.url.searchParams.get("limit"), 20, 1, 100);
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

      const [runs, total] = await Promise.all([
        listRemediationRunsByServerId(serverId, limit + 1, offset),
        countRemediationRunsByServerId(serverId),
      ]);
      const page = paginateOffsetQuery(runs, limit, offset, total);

      return createJsonResponse(200, {
        ok: true,
        data: {
          runs: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/incidents\/[^/]+\/close$/,
    handler: async (context) => {
      const incidentId = context.url.pathname.split("/")[2];

      if (!incidentId) {
        return createJsonResponse(400, {
          ok: false,
          error: {
            code: "INVALID_INCIDENT_ID",
            message: "Incident id is required in the request path",
            requestId: context.requestId,
          },
        });
      }

      const incident = await getIncidentById(incidentId);

      if (!incident) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "INCIDENT_NOT_FOUND",
            message: "Incident record was not found",
            requestId: context.requestId,
          },
        });
      }

      if (incident.status !== "resolved") {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "INCIDENT_CLOSE_DENIED",
            message: "Only resolved incidents can be closed",
            requestId: context.requestId,
          },
        });
      }

      await closeIncident(incident.id);
      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "incident.closed",
        targetType: "incident",
        targetId: incident.id,
        metadata: {
          previousStatus: "resolved",
        },
      });

      const closedIncident = await getIncidentById(incident.id);

      return createJsonResponse(200, {
        ok: true,
        data: {
          incident: closedIncident,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/incidents\/[^/]+\/remediate$/,
    handler: async (context) => {
      const incidentId = context.url.pathname.split("/")[2];

      if (!incidentId) {
        return createJsonResponse(400, {
          ok: false,
          error: {
            code: "INVALID_INCIDENT_ID",
            message: "Incident id is required in the request path",
            requestId: context.requestId,
          },
        });
      }

      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = remediationSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const incident = await getIncidentById(incidentId);

      if (!incident) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "INCIDENT_NOT_FOUND",
            message: "Incident record was not found",
            requestId: context.requestId,
          },
        });
      }

      const action = getRemediationActionByType(parsed.data.actionType);

      if (!action) {
        return createJsonResponse(400, {
          ok: false,
          error: {
            code: "REMEDIATION_NOT_FOUND",
            message: "Requested remediation action is not allowlisted",
            requestId: context.requestId,
          },
        });
      }

      if (!getRemediationActionsForCheckType(incident.checkType).some((item) => item.actionType === action.actionType)) {
        return createJsonResponse(400, {
          ok: false,
          error: {
            code: "REMEDIATION_NOT_ALLOWED",
            message: "Requested remediation action is not allowed for this incident",
            requestId: context.requestId,
          },
        });
      }

      const server = await getServerById(incident.serverId);

      if (!server) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "SERVER_NOT_FOUND",
            message: "Server record was not found for this incident",
            requestId: context.requestId,
          },
        });
      }

      const decision = evaluateRemediationPolicy({
        action,
        incident,
        server,
      });

      if (decision.action !== "allow") {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "REMEDIATION_DENIED",
            message: decision.reasons.join(". "),
            requestId: context.requestId,
          },
        });
      }

      const run = await createRemediationRun({
        incidentId: incident.id,
        serverId: server.id,
        actionType: action.actionType,
        provider: action.provider,
        request: {
          incidentCheckType: incident.checkType,
        },
      });

      try {
        const execution = await executeRemediation({
          actionType: action.actionType,
          incident,
          server,
        });

        await completeRemediationRun({
          id: run.id,
          status: execution.status,
          outputSnippet: execution.outputSnippet,
          ...(execution.response ? { response: execution.response } : {}),
        });

        await writeAuditEvent({
          actorType: "user",
          actorId: "bootstrap-admin",
          eventType: "incident.remediation.executed",
          targetType: "incident",
          targetId: incident.id,
          metadata: {
            actionType: action.actionType,
            remediationRunId: run.id,
            status: execution.status,
          },
        });

        if (execution.status === "succeeded") {
          await markIncidentRemediationPending(incident.id);
          await writeAuditEvent({
            actorType: "system",
            eventType: "incident.remediation_pending",
            targetType: "incident",
            targetId: incident.id,
            metadata: {
              remediationRunId: run.id,
              reason: "awaiting healthy follow-up check",
            },
          });
          await notifyEvent({
            eventType: "incident.remediation_pending",
            subject: `Remediation pending verification for ${server.name}`,
            bodyText: `Remediation ${action.actionType} succeeded for incident ${incident.id} on ${server.hostname}. A healthy follow-up check is still required before resolution.`,
          });
        } else {
          await notifyEvent({
            eventType: "incident.remediation.failed",
            subject: `Remediation failed for ${server.name}`,
            bodyText: `Remediation ${action.actionType} failed for incident ${incident.id} on ${server.hostname}. Output: ${execution.outputSnippet}`,
          });
        }

        const runs = await listRemediationRunsByServerId(server.id, 20);
        const incidents = await listIncidentsByServerId(server.id, 20);
        const enrichedIncidents = await Promise.all(incidents.map((item) => enrichIncident(item)));

        return createJsonResponse(200, {
          ok: true,
          data: {
            incidents: enrichedIncidents,
            runs,
          },
        });
      } catch (error) {
        await completeRemediationRun({
          id: run.id,
          status: "failed",
          outputSnippet: error instanceof Error ? error.message : "Remediation failed",
        });
        await notifyEvent({
          eventType: "incident.remediation.failed",
          subject: `Remediation failed for ${server.name}`,
          bodyText: `Remediation ${action.actionType} failed for incident ${incident.id} on ${server.hostname}. Output: ${error instanceof Error ? error.message : "Remediation failed"}`,
        });

        return createJsonResponse(500, {
          ok: false,
          error: {
            code: "REMEDIATION_FAILED",
            message: error instanceof Error ? error.message : "Remediation failed",
            requestId: context.requestId,
          },
        });
      }
    },
  },
];
