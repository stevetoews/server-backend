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

interface SmtpLikeError {
  code?: string;
  response?: string;
  responseCode?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isSmtpLikeError(error: unknown): error is SmtpLikeError {
  return typeof error === "object" && error !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Notification delivery failed";
}

function getSmtpResponseText(error: unknown): string | undefined {
  if (!isSmtpLikeError(error)) {
    return undefined;
  }

  if (typeof error.response === "string" && error.response.trim()) {
    return error.response;
  }

  if (typeof error.responseCode === "number") {
    return `SMTP response ${error.responseCode}`;
  }

  return undefined;
}

function isRetryableSmtpError(error: unknown): boolean {
  if (!isSmtpLikeError(error)) {
    return false;
  }

  if (error.code === "EAUTH") {
    return false;
  }

  if (typeof error.responseCode === "number") {
    return error.responseCode >= 400 && error.responseCode < 500;
  }

  return (
    error.code === "ECONNECTION" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ESOCKET" ||
    error.code === "ECONNRESET" ||
    error.code === "ECONNREFUSED" ||
    error.code === "EHOSTUNREACH" ||
    error.code === "ENETUNREACH" ||
    error.code === "EAI_AGAIN"
  );
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
    connectionTimeout: 10_000,
    host: env.NOTIFICATION_SMTP_HOST,
    greetingTimeout: 10_000,
    port: env.NOTIFICATION_SMTP_PORT ?? 587,
    secure: env.NOTIFICATION_SMTP_SECURE ?? false,
    socketTimeout: 15_000,
  });
}

async function sendMailWithRetry(
  transport: nodemailer.Transporter,
  payload: {
    from: string;
    subject: string;
    text: string;
    to: string;
  },
): Promise<TransportResult> {
  const attempts = 3;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const info = await transport.sendMail(payload);

      return {
        responseText: info.response || info.messageId || "SMTP delivery accepted",
        transportKind: "smtp",
      };
    } catch (error) {
      if (attempt === attempts || !isRetryableSmtpError(error)) {
        throw error;
      }

      console.log(
        JSON.stringify({
          scope: "notification",
          transport: "smtp",
          attempt,
          retryable: true,
          retrying: true,
          error: error instanceof Error ? error.message : "SMTP delivery failed",
          to: payload.to,
        }),
      );

      await sleep(500 * attempt);
    }
  }

  throw new Error("SMTP delivery failed");
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

  return sendMailWithRetry(transport, {
    from: getNotificationFromAddress(),
    subject: input.subject,
    text: input.bodyText,
    to: target.address,
  });
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
  transportResponse?: string;
}): Promise<void> {
  const deliveryRecord: Parameters<typeof createNotificationDelivery>[0] = {
    bodyText: input.bodyText,
    errorMessage: getErrorMessage(input.error),
    eventType: input.eventType,
    status: "failed",
    subject: input.subject,
    targetId: input.targetId,
  };

  if (input.transportKind) {
    deliveryRecord.transportKind = input.transportKind;
  }

  if (input.transportResponse) {
    deliveryRecord.transportResponse = input.transportResponse;
  }

  await createNotificationDelivery(deliveryRecord);
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
      const transportResponse = getSmtpResponseText(error);
      const failureRecord: Parameters<typeof persistFailedDelivery>[0] = {
        bodyText: input.bodyText,
        error,
        eventType: input.eventType,
        subject: input.subject,
        targetId: target.id,
        transportKind: env.NOTIFICATION_SMTP_HOST ? "smtp" : "simulated",
      };

      if (transportResponse) {
        failureRecord.transportResponse = transportResponse;
      }

      await persistFailedDelivery(failureRecord);
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
    const transportResponse = getSmtpResponseText(error);
    const failureRecord: Parameters<typeof persistFailedDelivery>[0] = {
      bodyText: `This is a simulated test notification for ${target.address}.`,
      error,
      eventType: "notification.test",
      subject: `Test notification for ${target.label}`,
      targetId: target.id,
      transportKind: env.NOTIFICATION_SMTP_HOST ? "smtp" : "simulated",
    };

    if (transportResponse) {
      failureRecord.transportResponse = transportResponse;
    }

    await persistFailedDelivery(failureRecord);
    throw error;
  }
}
