import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createJsonResponse, createValidationErrorResponse, readJsonBody, type AppRoute } from "../lib/http.js";
import { writeAuditEvent } from "../modules/audit/logger.js";
import {
  type ServerRecord,
  serverDraftSchema,
} from "../modules/contracts/server.js";
import { findProviderMatches } from "../modules/providers/matcher.js";
import { DigitalOceanAdapter } from "../modules/providers/digitalocean.js";
import { LinodeAdapter } from "../modules/providers/linode.js";
import { evaluateActivationPolicy } from "../modules/policies/engine.js";
import { discoverHostMetadata, testSshConnection } from "../modules/ssh/discovery.js";

const activateServerSchema = z.object({
  providerInstanceId: z.string().min(1),
  providerKind: z.enum(["linode", "digitalocean"]),
});

const mockServers: ServerRecord[] = [];

export const serverRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/servers$/,
    handler: async () =>
      createJsonResponse(200, {
        ok: true,
        data: mockServers,
      }),
  },
  {
    method: "POST",
    pattern: /^\/servers$/,
    handler: async (context) => {
      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = serverDraftSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const sshTarget = {
        host: parsed.data.ipAddress ?? parsed.data.hostname,
        port: parsed.data.sshPort,
        username: parsed.data.sshUsername,
      };

      const sshResult = await testSshConnection(sshTarget);
      const discovery = await discoverHostMetadata(sshTarget);
      const providerMatches = await findProviderMatches({
        hostname: discovery.hostname,
        providers: [new LinodeAdapter(), new DigitalOceanAdapter()],
        ...(parsed.data.ipAddress ? { ipAddress: parsed.data.ipAddress } : {}),
      });

      const now = new Date().toISOString();
      const record: ServerRecord = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        onboardingStatus: providerMatches.length > 0 ? "discovered" : "ssh_verified",
        ...parsed.data,
        ...(providerMatches[0] ? { providerMatch: providerMatches[0] } : {}),
      };

      mockServers.push(record);

      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "server.draft.created",
        targetType: "server",
        targetId: record.id,
        metadata: {
          sshResult,
          discovery,
          providerMatchCount: providerMatches.length,
        },
      });

      return createJsonResponse(201, {
        ok: true,
        data: {
          server: record,
          onboarding: {
            ssh: sshResult,
            discovery,
            providerMatches,
            nextStep: "Require explicit provider match before activation",
          },
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers\/[^/]+\/activate$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];
      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = activateServerSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const server = mockServers.find((item) => item.id === serverId);

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

      server.providerMatch = {
        providerInstanceId: parsed.data.providerInstanceId,
        providerKind: parsed.data.providerKind,
        confidence: 1,
        reasons: ["Admin explicitly confirmed provider match"],
      };
      server.onboardingStatus = "provider_matched";
      server.updatedAt = new Date().toISOString();

      const decision = evaluateActivationPolicy({
        onboardingStatus: server.onboardingStatus,
        ...(server.providerMatch ? { providerMatch: server.providerMatch } : {}),
      });

      if (decision.action === "allow") {
        server.onboardingStatus = "active";
      }

      return createJsonResponse(200, {
        ok: true,
        data: {
          server,
          activation: decision,
          nextStep: "SpinupWP mapping becomes available after provider match",
        },
      });
    },
  },
];
