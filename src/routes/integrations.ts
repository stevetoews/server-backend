import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createJsonResponse, createValidationErrorResponse, readJsonBody, type AppRoute } from "../lib/http.js";
import { integrationKindSchema } from "../modules/contracts/server.js";

const integrationSchema = z.object({
  kind: integrationKindSchema,
  label: z.string().min(2).max(80),
  enabled: z.boolean().default(true),
});

const integrations = [
  { id: "int-linode", kind: "linode", label: "Linode Primary", enabled: true },
  { id: "int-do", kind: "digitalocean", label: "DigitalOcean Fallback", enabled: false },
  { id: "int-spinupwp", kind: "spinupwp", label: "SpinupWP Fleet", enabled: false },
];

export const integrationRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/integrations$/,
    handler: async () =>
      createJsonResponse(200, {
        ok: true,
        data: integrations,
      }),
  },
  {
    method: "POST",
    pattern: /^\/integrations$/,
    handler: async (context) => {
      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = integrationSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const integration = {
        id: randomUUID(),
        ...parsed.data,
      };

      integrations.push(integration);

      return createJsonResponse(201, {
        ok: true,
        data: integration,
      });
    },
  },
];
