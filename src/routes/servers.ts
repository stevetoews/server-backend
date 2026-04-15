import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  createServerDraft,
  getServerById,
  listServers,
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
import { discoverHostMetadata, testSshConnection } from "../modules/ssh/discovery.js";
import type { SshCredentials } from "../modules/ssh/types.js";
import { encryptSecret } from "../modules/security/secrets.js";

const createServerSchema = z
  .object({
    name: serverDraftSchema.shape.name,
    environment: serverDraftSchema.shape.environment,
    hostname: z.string().max(255).optional(),
    ipAddress: serverDraftSchema.shape.ipAddress,
    sshPort: serverDraftSchema.shape.sshPort,
    sshUsername: serverDraftSchema.shape.sshUsername,
    sshAuthMode: serverDraftSchema.shape.sshAuthMode,
    notes: serverDraftSchema.shape.notes,
    sshPassword: z.string().min(1).max(500).optional(),
  })
  .superRefine((value, context) => {
    const normalizedHostname = value.hostname?.trim();

    if (!normalizedHostname && !value.ipAddress) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hostname or public IP is required",
        path: ["hostname"],
      });
    }

    if (value.sshAuthMode === "password" && !value.sshPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SSH password is required when sshAuthMode is password",
        path: ["sshPassword"],
      });
    }
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

      const requestedHostname = parsed.data.hostname?.trim();
      const sshTarget = {
        host: parsed.data.ipAddress ?? requestedHostname ?? "",
        port: parsed.data.sshPort,
        username: parsed.data.sshUsername,
      };
      const sshCredentials: SshCredentials =
        parsed.data.sshAuthMode === "password"
          ? {
              authMode: "password",
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
        nextStep: "Server is active and ready for monitoring and WordOps inspection",
      };

      const now = new Date().toISOString();
      const record = await createServerDraft({
        id: randomUUID(),
        timestamp: now,
        draft: {
          environment: parsed.data.environment,
          hostname: requestedHostname || discovery.hostname,
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
        onboardingStatus: "active",
        osName: discovery.distro,
        osVersion: discovery.kernelVersion,
        ...(providerMatches[0] ? { providerMatch: providerMatches[0] } : {}),
      });

      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "server.created",
        targetType: "server",
        targetId: record.id,
        metadata: {
          activated: true,
          discovery,
          providerMatchCount: providerMatches.length,
          sshResult,
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
];
