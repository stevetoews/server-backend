import { z } from "zod";

import {
  createIntegration,
  listIntegrations,
} from "../db/repositories/integrations.js";
import { createJsonResponse, createValidationErrorResponse, readJsonBody, type AppRoute } from "../lib/http.js";
import { integrationKindSchema } from "../modules/contracts/server.js";

const integrationSchema = z.object({
  kind: integrationKindSchema,
  label: z.string().min(2).max(80),
  enabled: z.boolean().default(true),
});

export const integrationRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/integrations$/,
    handler: async () => {
      const integrations = await listIntegrations();

      return createJsonResponse(200, {
        ok: true,
        data: integrations,
      });
    },
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

      const integration = await createIntegration(parsed.data);

      return createJsonResponse(201, {
        ok: true,
        data: integration,
      });
    },
  },
];
