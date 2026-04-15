import nodemailer from "nodemailer";

import { env } from "../../config/env.js";
import { createNotificationDelivery } from "../../db/repositories/notification-deliveries.js";
import {
  getNotificationTargetById,
  listEnabledNotificationTargets,
  type NotificationTargetRecord,
} from "../../db/repositories/notification-targets.js";

export interface NotificationEventInput {
  bodyText: string;
  eventType: string;
  subject: string;
}

interface TransportResult {
  responseText: string;
  transportKind: "smtp" | "simulated";
}

function getNotificationFromAddress(): string {
  return env.NOTIFICATION_FROM_ADDRESS ?? env.BOOTSTRAP_ADMIN_EMAIL;
}

function buildSmtpTransport() {
  if (!env.NOTIFICATION_SMTP_HOST) {
    return null;
  }

  return nodemailer.createTransport({
    auth:
      env.NOTIFICATION_SMTP_USER || env.NOTIFICATION_SMTP_PASSWORD
        ? {
            pass: env.NOTIFICATION_SMTP_PASSWORD,
            user: env.NOTIFICATION_SMTP_USER ?? "",
          }
        : undefined,
    host: env.NOTIFICATION_SMTP_HOST,
    port: env.NOTIFICATION_SMTP_PORT ?? 587,
    secure: env.NOTIFICATION_SMTP_SECURE ?? false,
  });
}

async function deliverToEmailTarget(
  target: NotificationTargetRecord,
  input: NotificationEventInput,
): Promise<TransportResult> {
  const transport = buildSmtpTransport();

  if (!transport) {
    const responseText = `Simulated delivery to ${target.address}`;

    console.log(
      JSON.stringify({
        scope: "notification",
        channel: target.channel,
        eventType: input.eventType,
        target: target.address,
        subject: input.subject,
        bodyText: input.bodyText,
        simulated: true,
      }),
    );

    return {
      responseText,
      transportKind: "simulated",
    };
  }

  const info = await transport.sendMail({
    from: getNotificationFromAddress(),
    subject: input.subject,
    text: input.bodyText,
    to: target.address,
  });

  return {
    responseText: info.response || info.messageId || "SMTP delivery accepted",
    transportKind: "smtp",
  };
}

async function persistDeliveryAttempt(input: {
  eventType: string;
  result: TransportResult;
  subject: string;
  targetId: string;
  bodyText: string;
}): Promise<void> {
  await createNotificationDelivery({
    targetId: input.targetId,
    eventType: input.eventType,
    subject: input.subject,
    bodyText: input.bodyText,
    status: "delivered",
    transportKind: input.result.transportKind,
    transportResponse: input.result.responseText,
  });

  console.log(
    JSON.stringify({
      scope: "notification",
      eventType: input.eventType,
      targetId: input.targetId,
      transport: input.result.transportKind,
      response: input.result.responseText,
      status: "delivered",
    }),
  );
}

async function persistFailedDelivery(input: {
  bodyText: string;
  eventType: string;
  error: unknown;
  subject: string;
  targetId: string;
  transportKind?: TransportResult["transportKind"];
}): Promise<void> {
  await createNotificationDelivery({
    bodyText: input.bodyText,
    errorMessage: input.error instanceof Error ? input.error.message : "Notification delivery failed",
    eventType: input.eventType,
    status: "failed",
    subject: input.subject,
    targetId: input.targetId,
    ...(input.transportKind ? { transportKind: input.transportKind } : {}),
  });
}

export async function notifyEvent(input: NotificationEventInput): Promise<void> {
  const targets = await listEnabledNotificationTargets();

  for (const target of targets) {
    try {
      if (target.channel === "email") {
        const result = await deliverToEmailTarget(target, input);
        await persistDeliveryAttempt({
          bodyText: input.bodyText,
          eventType: input.eventType,
          result,
          subject: input.subject,
          targetId: target.id,
        });
      }
    } catch (error) {
      await persistFailedDelivery({
        bodyText: input.bodyText,
        error,
        eventType: input.eventType,
        subject: input.subject,
        targetId: target.id,
        transportKind: env.NOTIFICATION_SMTP_HOST ? "smtp" : "simulated",
      });
    }
  }
}

export async function sendTestNotification(targetId: string): Promise<void> {
  const target = await getNotificationTargetById(targetId);

  if (!target) {
    throw new Error("Notification target was not found");
  }

  if (!target.enabled) {
    await createNotificationDelivery({
      targetId: target.id,
      eventType: "notification.test",
      subject: `Test notification skipped for ${target.label}`,
      bodyText: `Notification target ${target.address} is disabled.`,
      status: "skipped",
      transportKind: "simulated",
      transportResponse: "Target disabled before delivery",
    });
    return;
  }

  try {
    if (target.channel === "email") {
      const result = await deliverToEmailTarget(target, {
        eventType: "notification.test",
        subject: `Test notification for ${target.label}`,
        bodyText: `This is a simulated test notification for ${target.address}.`,
      });

      await persistDeliveryAttempt({
        bodyText: `This is a simulated test notification for ${target.address}.`,
        eventType: "notification.test",
        result,
        subject: `Test notification for ${target.label}`,
        targetId: target.id,
      });
    }
  } catch (error) {
    await persistFailedDelivery({
      bodyText: `This is a simulated test notification for ${target.address}.`,
      error,
      eventType: "notification.test",
      subject: `Test notification for ${target.label}`,
      targetId: target.id,
      transportKind: env.NOTIFICATION_SMTP_HOST ? "smtp" : "simulated",
    });
    throw error;
  }
}
