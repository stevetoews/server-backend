import { z } from "zod";

import {
  createNotificationTarget,
  deleteNotificationTarget,
  getNotificationTargetById,
  countNotificationTargetsWithQuery,
  getNotificationTargetByChannelAndAddress,
  listNotificationTargetsWithQuery,
  updateNotificationTarget,
} from "../db/repositories/notification-targets.js";
import {
  countNotificationDeliveries,
  listNotificationDeliveries,
} from "../db/repositories/notification-deliveries.js";
import {
  createJsonResponse,
  createValidationErrorResponse,
  readJsonBody,
  type AppRoute,
} from "../lib/http.js";
import { paginateOffsetQuery, parseBoundedInt } from "../lib/pagination.js";
import { sendTestNotification } from "../modules/notifications/service.js";

const notificationTargetSchema = z.object({
  channel: z.literal("email"),
  label: z.string().min(2).max(80),
  address: z.string().email(),
  enabled: z.boolean().default(true),
});

const notificationTargetUpdateSchema = z.object({
  label: z.string().min(2).max(80).optional(),
  address: z.string().email().optional(),
  enabled: z.boolean().optional(),
});

export const notificationRoutes: AppRoute[] = [
  {
    method: "GET",
    pattern: /^\/notifications\/targets$/,
    handler: async (context) => {
      const limit = parseBoundedInt(context.url.searchParams.get("limit"), 50, 1, 100);
      const offset = parseBoundedInt(context.url.searchParams.get("offset"), 0, 0, 10_000);
      const filter = {
        ...(context.url.searchParams.get("channel") === "email"
          ? { channel: "email" as const }
          : {}),
        ...(context.url.searchParams.get("enabled") === null
          ? {}
          : { enabled: context.url.searchParams.get("enabled") === "true" }),
      };
      const [targets, total] = await Promise.all([
        listNotificationTargetsWithQuery({
          ...filter,
          limit: limit + 1,
          offset,
        }),
        countNotificationTargetsWithQuery(filter),
      ]);
      const page = paginateOffsetQuery(targets, limit, offset, total);

      return createJsonResponse(200, {
        ok: true,
        data: {
          targets: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/notifications\/targets$/,
    handler: async (context) => {
      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = notificationTargetSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const existingTarget = await getNotificationTargetByChannelAndAddress({
        channel: parsed.data.channel,
        address: parsed.data.address,
      });

      if (existingTarget) {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "NOTIFICATION_TARGET_ALREADY_EXISTS",
            message: "A notification target already exists for this channel and address",
            requestId: context.requestId,
          },
        });
      }

      const target = await createNotificationTarget(parsed.data);

      if (!target) {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "NOTIFICATION_TARGET_ALREADY_EXISTS",
            message: "A notification target already exists for this channel and address",
            requestId: context.requestId,
          },
        });
      }

      return createJsonResponse(201, {
        ok: true,
        data: {
          target,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/notifications\/deliveries$/,
    handler: async (context) => {
      const limit = parseBoundedInt(context.url.searchParams.get("limit"), 50, 1, 100);
      const offset = parseBoundedInt(context.url.searchParams.get("offset"), 0, 0, 10_000);
      const targetId = context.url.searchParams.get("targetId") ?? undefined;
      const eventType = context.url.searchParams.get("eventType") ?? undefined;
      const filter = {
        ...(targetId ? { targetId } : {}),
        ...(eventType ? { eventType } : {}),
      };
      const [deliveries, total] = await Promise.all([
        listNotificationDeliveries({
          limit: limit + 1,
          offset,
          ...filter,
        }),
        countNotificationDeliveries(filter),
      ]);
      const page = paginateOffsetQuery(deliveries, limit, offset, total);

      return createJsonResponse(200, {
        ok: true,
        data: {
          deliveries: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/notifications\/targets\/[^/]+\/test$/,
    handler: async (context) => {
      const targetId = context.url.pathname.split("/")[3];

      if (!targetId) {
        return createJsonResponse(400, {
          ok: false,
          error: {
            code: "INVALID_NOTIFICATION_TARGET_ID",
            message: "Notification target id is required in the request path",
            requestId: context.requestId,
          },
        });
      }

      try {
        await sendTestNotification(targetId);
      } catch (error) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "NOTIFICATION_TARGET_NOT_FOUND",
            message: error instanceof Error ? error.message : "Notification target was not found",
            requestId: context.requestId,
          },
        });
      }

      const [deliveries, total] = await Promise.all([
        listNotificationDeliveries({
          targetId,
          eventType: "notification.test",
          limit: 6,
        }),
        countNotificationDeliveries({
          targetId,
          eventType: "notification.test",
        }),
      ]);
      const page = paginateOffsetQuery(deliveries, 5, 0, total);

      return createJsonResponse(200, {
        ok: true,
        data: {
          deliveries: page.items,
          pagination: page.pagination,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/notifications\/targets\/[^/]+$/,
    handler: async (context) => {
      const targetId = context.url.pathname.split("/")[3];

      if (!targetId) {
        return createJsonResponse(400, {
          ok: false,
          error: {
            code: "INVALID_NOTIFICATION_TARGET_ID",
            message: "Notification target id is required in the request path",
            requestId: context.requestId,
          },
        });
      }

      const rawBody = await readJsonBody<unknown>(context.req);
      const parsed = notificationTargetUpdateSchema.safeParse(rawBody);

      if (!parsed.success) {
        return createValidationErrorResponse(context.requestId, parsed.error.flatten());
      }

      const currentTarget = await getNotificationTargetById(targetId);

      if (!currentTarget) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "NOTIFICATION_TARGET_NOT_FOUND",
            message: "Notification target was not found",
            requestId: context.requestId,
          },
        });
      }

      const target = await updateNotificationTarget({
        id: targetId,
        ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
        ...(parsed.data.address !== undefined ? { address: parsed.data.address } : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      });

      if (!target) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "NOTIFICATION_TARGET_NOT_FOUND",
            message: "Notification target was not found",
            requestId: context.requestId,
          },
        });
      }

      if (parsed.data.enabled === false && currentTarget.enabled) {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "NOTIFICATION_TARGET_REQUIRED",
            message: "At least one notification target must remain enabled",
            requestId: context.requestId,
          },
        });
      }

      return createJsonResponse(200, {
        ok: true,
        data: {
          target,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/notifications\/targets\/[^/]+\/delete$/,
    handler: async (context) => {
      const targetId = context.url.pathname.split("/")[3];

      if (!targetId) {
        return createJsonResponse(400, {
          ok: false,
          error: {
            code: "INVALID_NOTIFICATION_TARGET_ID",
            message: "Notification target id is required in the request path",
            requestId: context.requestId,
          },
        });
      }

      const target = await getNotificationTargetById(targetId);

      if (!target) {
        return createJsonResponse(404, {
          ok: false,
          error: {
            code: "NOTIFICATION_TARGET_NOT_FOUND",
            message: "Notification target was not found",
            requestId: context.requestId,
          },
        });
      }

      if (target.enabled) {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "NOTIFICATION_TARGET_REQUIRED",
            message: "At least one notification target must remain enabled",
            requestId: context.requestId,
          },
        });
      }

      const deleted = await deleteNotificationTarget(targetId);

      if (!deleted) {
        return createJsonResponse(409, {
          ok: false,
          error: {
            code: "NOTIFICATION_TARGET_REQUIRED",
            message: "At least one notification target must remain enabled",
            requestId: context.requestId,
          },
        });
      }

      return createJsonResponse(200, {
        ok: true,
        data: {
          deleted: true,
          targetId,
        },
      });
    },
  },
];
