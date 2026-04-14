import { z } from "zod";

import {
  getIncidentById,
  listIncidents,
  listIncidentsByServerId,
  markIncidentRemediationPending,
  resolveIncident,
} from "../db/repositories/incidents.js";
import {
  completeRemediationRun,
  createRemediationRun,
  listRemediationRunsByServerId,
} from "../db/repositories/remediation-runs.js";
import { getServerById } from "../db/repositories/servers.js";
import { createJsonResponse, type AppRoute } from "../lib/http.js";
import { createValidationErrorResponse, readJsonBody } from "../lib/http.js";
import { writeAuditEvent } from "../modules/audit/logger.js";
import { getRemediationActionsForCheckType } from "../modules/remediation/catalog.js";
import { executeRemediation } from "../modules/remediation/service.js";

const remediationSchema = z.object({
  actionType: z.string().min(1),
});

export const incidentRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/incidents$/,
    handler: async () => {
      const incidents = await listIncidents(25);

      return createJsonResponse(200, {
        ok: true,
        data: {
          incidents,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+\/incidents$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];

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

      const incidents = await listIncidentsByServerId(serverId, 20);

      return createJsonResponse(200, {
        ok: true,
        data: {
          incidents,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+\/remediations$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];

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

      const runs = await listRemediationRunsByServerId(serverId, 20);

      return createJsonResponse(200, {
        ok: true,
        data: {
          runs,
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

      if (incident.status !== "open") {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "INCIDENT_NOT_OPEN",
            message: "Only open incidents can be remediated",
            requestId: context.requestId,
          },
        });
      }

      const allowedActions = getRemediationActionsForCheckType(incident.checkType).map(
        (action) => action.actionType,
      );

      if (!allowedActions.includes(parsed.data.actionType)) {
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

      const run = await createRemediationRun({
        incidentId: incident.id,
        serverId: server.id,
        actionType: parsed.data.actionType,
        provider: parsed.data.actionType === "provider.reboot" ? "linode" : "ssh",
        request: {
          incidentCheckType: incident.checkType,
        },
      });

      try {
        const execution = await executeRemediation({
          actionType: parsed.data.actionType,
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
            actionType: parsed.data.actionType,
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
        }

        const runs = await listRemediationRunsByServerId(server.id, 20);
        const incidents = await listIncidentsByServerId(server.id, 20);

        return createJsonResponse(200, {
          ok: true,
          data: {
            incidents,
            runs,
          },
        });
      } catch (error) {
        await completeRemediationRun({
          id: run.id,
          status: "failed",
          outputSnippet: error instanceof Error ? error.message : "Remediation failed",
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
