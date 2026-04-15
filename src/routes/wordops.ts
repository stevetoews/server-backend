import { z } from "zod";

import { listSitesByServerId, replaceSitesForServer } from "../db/repositories/sites.js";
import { getServerById } from "../db/repositories/servers.js";
import { createJsonResponse, createValidationErrorResponse, readJsonBody, type AppRoute } from "../lib/http.js";
import { writeAuditEvent } from "../modules/audit/logger.js";
import {
  createWordopsSite,
  deleteWordopsSite,
  disableWordopsSite,
  enableWordopsSite,
  installWordopsStack,
  inspectServerWordops,
} from "../modules/wordops/service.js";

const createSiteSchema = z
  .object({
    adminEmail: z.string().email().optional(),
    adminPassword: z.string().min(8).max(100).optional(),
    adminUser: z.string().min(1).max(60).optional(),
    cacheProfile: z.enum(["wp", "wpfc", "wpredis", "wpsc", "wprocket", "wpce"]),
    domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Use a valid domain"),
    hsts: z.boolean().optional(),
    letsEncrypt: z.boolean().optional(),
    phpVersion: z.enum(["8.2", "8.3"]).optional(),
    vhostOnly: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.hsts && !value.letsEncrypt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HSTS requires Let's Encrypt to be enabled",
        path: ["hsts"],
      });
    }
  });

const stackInstallSchema = z.object({
  profile: z.enum(["web"]).default("web"),
});

async function loadServerOr404(serverId: string, requestId: string) {
  const server = await getServerById(serverId);

  if (!server) {
    return createJsonResponse(404, {
      ok: false,
      error: {
        code: "SERVER_NOT_FOUND",
        message: "Server record was not found",
        requestId,
      },
    });
  }

  return server;
}

async function syncWordopsSitesForServer(serverId: string) {
  const overview = await inspectServerWordops(serverId);

  if (!overview.installed) {
    throw new Error("WordOps is not installed on this server");
  }

  if (overview.status !== "ready") {
    throw new Error("WordOps commands did not complete successfully on this server");
  }

  const sites = await replaceSitesForServer({
    serverId,
    sites: overview.sites,
    timestamp: new Date().toISOString(),
  });

  return {
    overview,
    sites,
  };
}

function invalidServerIdResponse(requestId: string) {
  return createJsonResponse(400, {
    ok: false,
    error: {
      code: "INVALID_SERVER_ID",
      message: "Server id is required in the request path",
      requestId,
    },
  });
}

function invalidSitePathResponse(requestId: string) {
  return createJsonResponse(400, {
    ok: false,
    error: {
      code: "INVALID_SITE_PATH",
      message: "Server id and site domain are required in the request path",
      requestId,
    },
  });
}

export const wordopsRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+\/wordops$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];

      if (!serverId) {
        return invalidServerIdResponse(context.requestId);
      }

      const server = await loadServerOr404(serverId, context.requestId);

      if ("status" in server) {
        return server;
      }

      let overview;

      try {
        overview = await inspectServerWordops(serverId);
      } catch (error) {
        return createJsonResponse(502, {
          ok: false,
          error: {
            code: "WORDOPS_INSPECTION_FAILED",
            message: error instanceof Error ? error.message : "Unable to inspect WordOps on this server",
            requestId: context.requestId,
          },
        });
      }

      return createJsonResponse(200, {
        ok: true,
        data: {
          overview,
          server,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/servers\/[^/]+\/sites$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];

      if (!serverId) {
        return invalidServerIdResponse(context.requestId);
      }

      const server = await loadServerOr404(serverId, context.requestId);

      if ("status" in server) {
        return server;
      }

      const sites = await listSitesByServerId(serverId);

      return createJsonResponse(200, {
        ok: true,
        data: {
          server,
          sites,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers\/[^/]+\/wordops\/sync$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];

      if (!serverId) {
        return invalidServerIdResponse(context.requestId);
      }

      const server = await loadServerOr404(serverId, context.requestId);

      if ("status" in server) {
        return server;
      }

      let syncResult;

      try {
        syncResult = await syncWordopsSitesForServer(serverId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to sync WordOps sites";
        const code =
          /not installed/i.test(message) ? "WORDOPS_NOT_INSTALLED" : "WORDOPS_UNAVAILABLE";

        return createJsonResponse(409, {
          ok: false,
          error: {
            code,
            message,
            requestId: context.requestId,
          },
        });
      }

      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "server.wordops.sites_synced",
        targetType: "server",
        targetId: serverId,
        metadata: {
          siteCount: syncResult.sites.length,
          wordopsStatus: syncResult.overview.status,
        },
      });

      return createJsonResponse(200, {
        ok: true,
        data: {
          overview: syncResult.overview,
          server,
          sites: syncResult.sites,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers\/[^/]+\/wordops\/stack\/install$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];

      if (!serverId) {
        return invalidServerIdResponse(context.requestId);
      }

      const server = await loadServerOr404(serverId, context.requestId);

      if ("status" in server) {
        return server;
      }

      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = stackInstallSchema.safeParse(rawBody ?? {});

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const mutation = await installWordopsStack(serverId, parsed.data);

      if (mutation.status === "failed") {
        return createJsonResponse(502, {
          ok: false,
          error: {
            code: "WORDOPS_STACK_INSTALL_FAILED",
            message: mutation.output,
            requestId: context.requestId,
          },
        });
      }

      const syncResult = await syncWordopsSitesForServer(serverId);

      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "server.wordops.stack_installed",
        targetType: "server",
        targetId: serverId,
        metadata: {
          output: mutation.output,
          profile: parsed.data.profile,
        },
      });

      return createJsonResponse(200, {
        ok: true,
        data: {
          execution: mutation,
          overview: syncResult.overview,
          server,
          sites: syncResult.sites,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers\/[^/]+\/sites$/,
    handler: async (context) => {
      const serverId = context.url.pathname.split("/")[2];

      if (!serverId) {
        return invalidServerIdResponse(context.requestId);
      }

      const server = await loadServerOr404(serverId, context.requestId);

      if ("status" in server) {
        return server;
      }

      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = createSiteSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const createInput = {
        cacheProfile: parsed.data.cacheProfile,
        domain: parsed.data.domain,
        ...(parsed.data.adminEmail ? { adminEmail: parsed.data.adminEmail } : {}),
        ...(parsed.data.adminPassword ? { adminPassword: parsed.data.adminPassword } : {}),
        ...(parsed.data.adminUser ? { adminUser: parsed.data.adminUser } : {}),
        ...(parsed.data.hsts !== undefined ? { hsts: parsed.data.hsts } : {}),
        ...(parsed.data.letsEncrypt !== undefined ? { letsEncrypt: parsed.data.letsEncrypt } : {}),
        ...(parsed.data.phpVersion ? { phpVersion: parsed.data.phpVersion } : {}),
        ...(parsed.data.vhostOnly !== undefined ? { vhostOnly: parsed.data.vhostOnly } : {}),
      } as const;

      const mutation = await createWordopsSite(serverId, createInput);

      if (mutation.status === "failed") {
        return createJsonResponse(502, {
          ok: false,
          error: {
            code: "WORDOPS_SITE_CREATE_FAILED",
            message: mutation.output,
            requestId: context.requestId,
          },
        });
      }

      const syncResult = await syncWordopsSitesForServer(serverId);

      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "site.wordops.created",
        targetType: "site",
        targetId: parsed.data.domain,
        metadata: {
          cacheProfile: parsed.data.cacheProfile,
          letsEncrypt: parsed.data.letsEncrypt ?? false,
          output: mutation.output,
          serverId,
          vhostOnly: parsed.data.vhostOnly ?? false,
        },
      });

      return createJsonResponse(201, {
        ok: true,
        data: {
          execution: mutation,
          overview: syncResult.overview,
          server,
          sites: syncResult.sites,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers\/[^/]+\/sites\/[^/]+\/enable$/,
    handler: async (context) => {
      const [, , serverId, , domain] = context.url.pathname.split("/");

      if (!serverId || !domain) {
        return invalidSitePathResponse(context.requestId);
      }

      const server = await loadServerOr404(serverId, context.requestId);

      if ("status" in server) {
        return server;
      }

      const decodedDomain = decodeURIComponent(domain);
      const mutation = await enableWordopsSite(serverId, decodedDomain);

      if (mutation.status === "failed") {
        return createJsonResponse(502, {
          ok: false,
          error: {
            code: "WORDOPS_SITE_ENABLE_FAILED",
            message: mutation.output,
            requestId: context.requestId,
          },
        });
      }

      const syncResult = await syncWordopsSitesForServer(serverId);

      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "site.wordops.enabled",
        targetType: "site",
        targetId: decodedDomain,
        metadata: {
          output: mutation.output,
          serverId,
        },
      });

      return createJsonResponse(200, {
        ok: true,
        data: {
          execution: mutation,
          overview: syncResult.overview,
          server,
          sites: syncResult.sites,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers\/[^/]+\/sites\/[^/]+\/disable$/,
    handler: async (context) => {
      const [, , serverId, , domain] = context.url.pathname.split("/");

      if (!serverId || !domain) {
        return invalidSitePathResponse(context.requestId);
      }

      const server = await loadServerOr404(serverId, context.requestId);

      if ("status" in server) {
        return server;
      }

      const decodedDomain = decodeURIComponent(domain);
      const mutation = await disableWordopsSite(serverId, decodedDomain);

      if (mutation.status === "failed") {
        return createJsonResponse(502, {
          ok: false,
          error: {
            code: "WORDOPS_SITE_DISABLE_FAILED",
            message: mutation.output,
            requestId: context.requestId,
          },
        });
      }

      const syncResult = await syncWordopsSitesForServer(serverId);

      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "site.wordops.disabled",
        targetType: "site",
        targetId: decodedDomain,
        metadata: {
          output: mutation.output,
          serverId,
        },
      });

      return createJsonResponse(200, {
        ok: true,
        data: {
          execution: mutation,
          overview: syncResult.overview,
          server,
          sites: syncResult.sites,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/servers\/[^/]+\/sites\/[^/]+\/delete$/,
    handler: async (context) => {
      const [, , serverId, , domain] = context.url.pathname.split("/");

      if (!serverId || !domain) {
        return invalidSitePathResponse(context.requestId);
      }

      const server = await loadServerOr404(serverId, context.requestId);

      if ("status" in server) {
        return server;
      }

      const decodedDomain = decodeURIComponent(domain);
      const mutation = await deleteWordopsSite(serverId, decodedDomain);

      if (mutation.status === "failed") {
        return createJsonResponse(502, {
          ok: false,
          error: {
            code: "WORDOPS_SITE_DELETE_FAILED",
            message: mutation.output,
            requestId: context.requestId,
          },
        });
      }

      const syncResult = await syncWordopsSitesForServer(serverId);

      await writeAuditEvent({
        actorType: "user",
        actorId: "bootstrap-admin",
        eventType: "site.wordops.deleted",
        targetType: "site",
        targetId: decodedDomain,
        metadata: {
          output: mutation.output,
          serverId,
        },
      });

      return createJsonResponse(200, {
        ok: true,
        data: {
          execution: mutation,
          overview: syncResult.overview,
          server,
          sites: syncResult.sites,
        },
      });
    },
  },
];
