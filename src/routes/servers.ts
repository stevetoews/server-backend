import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  confirmProviderMatch,
  createServerDraft,
  getServerById,
  listServers,
  mapSpinupwpServer,
} from "../db/repositories/servers.js";
import { getLatestHealthCheckByServerAndType } from "../db/repositories/health-checks.js";
import { createJsonResponse, createValidationErrorResponse, readJsonBody, type AppRoute } from "../lib/http.js";
import { writeAuditEvent } from "../modules/audit/logger.js";
import {
  type OnboardingSnapshot,
  type ServerRecord,
  serverDraftSchema,
} from "../modules/contracts/server.js";
import { findProviderMatches } from "../modules/providers/matcher.js";
import { DigitalOceanAdapter } from "../modules/providers/digitalocean.js";
import { LinodeAdapter } from "../modules/providers/linode.js";
import { SpinupwpAdapter } from "../modules/providers/spinupwp.js";
import { evaluateActivationPolicy } from "../modules/policies/engine.js";
import { discoverHostMetadata, testSshConnection } from "../modules/ssh/discovery.js";
import type { SshCredentials } from "../modules/ssh/types.js";
import { encryptSecret } from "../modules/security/secrets.js";

const createServerSchema = serverDraftSchema.extend({
  sshPassword: z.string().min(1).max(500).optional(),
}).superRefine((value, context) => {
  if (value.sshAuthMode === "password" && !value.sshPassword) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "SSH password is required when sshAuthMode is password",
      path: ["sshPassword"],
    });
  }
});

const activateServerSchema = z.object({
  providerInstanceId: z.string().min(1),
  providerKind: z.enum(["linode", "digitalocean"]),
});

const spinupwpMappingSchema = z.object({
  spinupwpServerId: z.string().min(1),
});

function readUsagePercent(rawOutput: Record<string, unknown> | undefined): number | undefined {
  if (!rawOutput) {
    return undefined;
  }

  const usagePercent = rawOutput.usagePercent;

  if (typeof usagePercent === "number") {
    return usagePercent;
  }

  const parsed = Number(usagePercent);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function enrichServerRecord(server: ServerRecord): Promise<ServerRecord> {
  if (server.providerMatch?.providerKind !== "linode") {
    return server;
  }

  try {
    const [providerSnapshot, diskCheck] = await Promise.all([
      new LinodeAdapter().buildSnapshot(server.providerMatch.providerInstanceId),
      getLatestHealthCheckByServerAndType({
        serverId: server.id,
        checkType: "host.disk.root",
      }),
    ]);

    return {
      ...server,
      providerSnapshot: {
        ...providerSnapshot,
        summary: `${providerSnapshot.planLabel} • ${providerSnapshot.cpuCores} CPU core${
          providerSnapshot.cpuCores === 1 ? "" : "s"
        } • ${providerSnapshot.ramGb} GB RAM`,
        usedStoragePercent: readUsagePercent(diskCheck?.rawOutput),
      },
    };
  } catch {
    return server;
  }
}

export const serverRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/servers$/,
    handler: async () => {
      const servers = await listServers();
      const enrichedServers = await Promise.all(servers.map((server) => enrichServerRecord(server)));

      return createJsonResponse(200, {
        ok: true,
        data: enrichedServers,
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+$/,
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

      const enrichedServer = await enrichServerRecord(server);

      return createJsonResponse(200, {
        ok: true,
        data: {
          server: enrichedServer,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers$/,
    handler: async (context) => {
      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = createServerSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const sshTarget = {
        host: parsed.data.ipAddress ?? parsed.data.hostname,
        port: parsed.data.sshPort,
        username: parsed.data.sshUsername,
      };
      const sshCredentials: SshCredentials =
        parsed.data.sshAuthMode === "password"
          ? {
              authMode: "password" as const,
              password: parsed.data.sshPassword ?? "",
            }
          : {
              authMode: parsed.data.sshAuthMode,
            };

      const sshResult = await testSshConnection(sshTarget, sshCredentials);
      const discovery = await discoverHostMetadata(sshTarget, sshCredentials);
      const providerMatches = await findProviderMatches({
        hostname: discovery.hostname,
        providers: [new LinodeAdapter(), new DigitalOceanAdapter()],
        ...(parsed.data.ipAddress ? { ipAddress: parsed.data.ipAddress } : {}),
      });
      const onboarding: OnboardingSnapshot = {
        ssh: sshResult,
        discovery,
        providerMatches,
        nextStep: "Require explicit provider match before activation",
      };

      const now = new Date().toISOString();
      const record = await createServerDraft({
        id: randomUUID(),
        timestamp: now,
        draft: {
          environment: parsed.data.environment,
          hostname: parsed.data.hostname,
          ...(parsed.data.ipAddress ? { ipAddress: parsed.data.ipAddress } : {}),
          name: parsed.data.name,
          ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
          sshAuthMode: parsed.data.sshAuthMode,
          sshPort: parsed.data.sshPort,
          sshUsername: parsed.data.sshUsername,
        },
        ...(parsed.data.sshPassword
          ? { encryptedSshPassword: encryptSecret(parsed.data.sshPassword) }
          : {}),
        onboardingStatus: providerMatches.length > 0 ? "discovered" : "ssh_verified",
        osName: discovery.distro,
        osVersion: discovery.kernelVersion,
        ...(providerMatches[0] ? { providerMatch: providerMatches[0] } : {}),
      });

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
          onboarding,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers\/[^/]+\/activate$/,
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

      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = activateServerSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
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

      const providerMatch: ServerRecord["providerMatch"] = {
        providerInstanceId: parsed.data.providerInstanceId,
        providerKind: parsed.data.providerKind,
        confidence: 1,
        reasons: ["Admin explicitly confirmed provider match"],
      };

      const decision = evaluateActivationPolicy({
        onboardingStatus: "provider_matched",
        providerMatch,
      });

      const updatedServer = await confirmProviderMatch({
        serverId,
        providerMatch,
        onboardingStatus: decision.action === "allow" ? "active" : "provider_matched",
        timestamp: new Date().toISOString(),
      });

      if (!updatedServer) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "SERVER_NOT_FOUND",
            message: "Server record disappeared before it could be activated",
            requestId: context.requestId,
          },
        });
      }

      return createJsonResponse(200, {
        ok: true,
        data: {
          server: updatedServer,
          activation: decision,
          nextStep: "SpinupWP mapping becomes available after provider match",
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+\/spinupwp-candidates$/,
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

      if (server.onboardingStatus !== "active") {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "SPINUPWP_LOCKED",
            message: "SpinupWP mapping is only available after provider activation",
            requestId: context.requestId,
          },
        });
      }

      const candidates = await new SpinupwpAdapter().listServers();

      return createJsonResponse(200, {
        ok: true,
        data: {
          server,
          candidates,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers\/[^/]+\/spinupwp-map$/,
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

      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = spinupwpMappingSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
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

      if (server.onboardingStatus !== "active") {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "SPINUPWP_LOCKED",
            message: "SpinupWP mapping is only available after provider activation",
            requestId: context.requestId,
          },
        });
      }

      const mappedServer = await mapSpinupwpServer({
        serverId,
        spinupwpServerId: parsed.data.spinupwpServerId,
        timestamp: new Date().toISOString(),
      });

      if (!mappedServer) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "SERVER_NOT_FOUND",
            message: "Server record disappeared before SpinupWP mapping completed",
            requestId: context.requestId,
          },
        });
      }

      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "server.spinupwp.mapped",
        targetType: "server",
        targetId: mappedServer.id,
        metadata: {
          spinupwpServerId: parsed.data.spinupwpServerId,
        },
      });

      return createJsonResponse(200, {
        ok: true,
        data: {
          server: mappedServer,
          nextStep: "Deterministic health checks can now reference the mapped SpinupWP server",
        },
      });
    },
  },
];
