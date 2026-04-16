import { insertHealthCheck, type HealthCheckRecord } from "../../db/repositories/health-checks.js";
import {
  createIncident,
  getActiveIncidentForServerCheck,
  resolveIncident,
  updateIncidentSummary,
} from "../../db/repositories/incidents.js";
import {
  getServerRuntimeById,
  listActiveMonitoredServerRuntimeRecords,
  type ServerRuntimeRecord,
} from "../../db/repositories/servers.js";
import { writeAuditEvent } from "../audit/logger.js";
import { notifyEvent } from "../notifications/service.js";
import { decryptSecret } from "../security/secrets.js";
import { assertAllowedCommandTemplate } from "../ssh/command-policy.js";
import { executeSshCommand } from "../ssh/client.js";
import type { SshCredentials } from "../ssh/types.js";
import { checkCatalog } from "./catalog.js";

export interface CheckRunSummary {
  checksCreated: number;
  serverId: string;
}

function getServerSshCredentials(server: ServerRuntimeRecord): SshCredentials {
  if (server.sshAuthMode === "password") {
    if (!server.encryptedSshPassword) {
      throw new Error("No encrypted SSH password is stored for this server");
    }

    return {
      authMode: "password",
      password: decryptSecret(server.encryptedSshPassword),
    };
  }

  if (server.sshAuthMode === "passwordless_agent") {
    return {
      authMode: "passwordless_agent",
    };
  }

  throw new Error(`SSH auth mode ${server.sshAuthMode} is not supported in the MVP`);
}

function parseServiceStatus(stdout: string): { serviceName: string; serviceStatus: string } {
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const payload = new Map<string, string>();

  for (const line of lines) {
    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    payload.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
  }

  return {
    serviceName: payload.get("service") ?? "unknown",
    serviceStatus: payload.get("status") ?? "unknown",
  };
}

function parseDiskUsage(stdout: string): number | null {
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const filesystemLine = lines[1];

  if (!filesystemLine) {
    return null;
  }

  const columns = filesystemLine.split(/\s+/);
  const usedColumn = columns[4];

  if (!usedColumn) {
    return null;
  }

  const usedPercent = Number.parseInt(usedColumn.replace("%", ""), 10);
  return Number.isFinite(usedPercent) ? usedPercent : null;
}

function getIncidentTitle(checkType: string, status: HealthCheckRecord["status"]): string {
  const labelByCheckType: Record<string, string> = {
    "host.uptime": "Host unreachable",
    "host.disk.root": "Disk usage above threshold",
    "service.nginx": "Nginx service unhealthy",
    "service.sql": "SQL service unhealthy",
    "service.phpfpm": "PHP-FPM service unhealthy",
  };

  const label = labelByCheckType[checkType] ?? checkType;
  return status === "degraded" ? `${label} (warning)` : label;
}

async function buildCheckResult(
  server: ServerRuntimeRecord,
  checkId: string,
): Promise<Omit<HealthCheckRecord, "createdAt" | "id">> {
  const templateIdByCheckType: Record<string, string> = {
    "host.uptime": "check.host.uptime",
    "host.disk.root": "check.disk.root",
    "service.nginx": "check.service.nginx",
    "service.sql": "check.service.sql",
    "service.phpfpm": "check.service.phpfpm",
  };
  const commandTemplateId = templateIdByCheckType[checkId];

  if (!commandTemplateId) {
    throw new Error(`No command template is registered for ${checkId}`);
  }

  const commandTemplate = assertAllowedCommandTemplate(commandTemplateId);
  const execution = await executeSshCommand({
    command: commandTemplate.command,
    credentials: getServerSshCredentials(server),
    target: {
      host: server.ipAddress ?? server.hostname,
      port: server.sshPort,
      username: server.sshUsername,
    },
  });

  if (checkId === "host.uptime") {
    return {
      serverId: server.id,
      checkType: checkId,
      latencyMs: execution.durationMs,
      status: execution.exitCode === 0 ? "healthy" : "failed",
      summary:
        execution.exitCode === 0
          ? execution.stdout || `Uptime probe succeeded for ${server.hostname}`
          : execution.stderr || `Uptime probe failed for ${server.hostname}`,
      rawOutput: {
        commandTemplateId,
        exitCode: execution.exitCode,
        stderr: execution.stderr,
        stdout: execution.stdout,
      },
    };
  }

  if (checkId === "host.disk.root") {
    const usagePercent = parseDiskUsage(execution.stdout);
    const status =
      usagePercent === null
        ? "failed"
        : usagePercent >= 90
          ? "failed"
          : usagePercent >= 80
            ? "degraded"
            : "healthy";

    return {
      serverId: server.id,
      checkType: checkId,
      latencyMs: execution.durationMs,
      status,
      summary:
        usagePercent === null
          ? "Unable to parse root filesystem usage"
          : status === "healthy"
            ? `Root filesystem usage is ${usagePercent}%`
            : `Root filesystem usage is ${usagePercent}%`,
      rawOutput: {
        commandTemplateId,
        exitCode: execution.exitCode,
        stderr: execution.stderr,
        stdout: execution.stdout,
        usagePercent,
      },
    };
  }

  const service = parseServiceStatus(execution.stdout);
  const serviceStatus = service.serviceStatus.toLowerCase();
  const status = serviceStatus === "active" ? "healthy" : "failed";

  return {
    serverId: server.id,
    checkType: checkId,
    latencyMs: execution.durationMs,
    status,
    summary:
      status === "healthy"
        ? `${service.serviceName} is active`
        : `${service.serviceName} reported ${service.serviceStatus}`,
    rawOutput: {
      commandTemplateId,
      exitCode: execution.exitCode,
      serviceName: service.serviceName,
      serviceStatus: service.serviceStatus,
      stderr: execution.stderr,
      stdout: execution.stdout,
    },
  };
}

function getIncidentPayload(check: HealthCheckRecord): {
  severity: "warning" | "critical";
  title: string;
} | null {
  if (check.status === "healthy") {
    return null;
  }

  return {
    severity: check.status === "degraded" ? "warning" : "critical",
    title: getIncidentTitle(check.checkType, check.status),
  };
}

async function syncIncidentForCheck(check: HealthCheckRecord): Promise<void> {
  const existing = await getActiveIncidentForServerCheck({
    serverId: check.serverId,
    checkType: check.checkType,
  });
  const incidentPayload = getIncidentPayload(check);

  if (!incidentPayload) {
    if (existing) {
      await resolveIncident(existing.id);
      await writeAuditEvent({
        actorType: "system",
        eventType: "incident.resolved",
        targetType: "incident",
        targetId: existing.id,
        metadata: {
          checkType: check.checkType,
          serverId: check.serverId,
        },
      });
      await notifyEvent({
        eventType: "incident.resolved",
        subject: `Incident resolved on ${check.serverId}`,
        bodyText: `${check.checkType} returned to healthy state for server ${check.serverId}. Summary: ${check.summary}`,
      });
    }

    return;
  }

  if (existing) {
    await updateIncidentSummary({
      id: existing.id,
      title: incidentPayload.title,
      summary: check.summary,
    });
    return;
  }

  const incident = await createIncident({
    checkType: check.checkType,
    serverId: check.serverId,
    severity: incidentPayload.severity,
    title: incidentPayload.title,
    summary: check.summary,
  });

  await writeAuditEvent({
    actorType: "system",
    eventType: "incident.opened",
    targetType: "incident",
    targetId: incident.id,
    metadata: {
      checkType: check.checkType,
      serverId: check.serverId,
      severity: incident.severity,
    },
  });
  await notifyEvent({
    eventType: "incident.opened",
    subject: `${incident.severity.toUpperCase()} incident on ${incident.serverId}`,
    bodyText: `${incident.title}\n\n${incident.summary ?? "No summary"}\n\nCheck type: ${incident.checkType ?? "unknown"}`,
  });
}

export async function runChecksForServer(serverIdOrServer: string | ServerRuntimeRecord): Promise<HealthCheckRecord[]> {
  const server =
    typeof serverIdOrServer === "string"
      ? await getServerRuntimeById(serverIdOrServer)
      : serverIdOrServer;

  if (!server) {
    throw new Error("Server record was not found for check execution");
  }

  const persisted: HealthCheckRecord[] = [];

  for (const check of checkCatalog) {
    try {
      const result = await buildCheckResult(server, check.id);
      const persistedCheck = await insertHealthCheck(result);
      await syncIncidentForCheck(persistedCheck);
      persisted.push(persistedCheck);
    } catch (error) {
      const failureSummary =
        error instanceof Error ? error.message : `Check ${check.id} failed`;
      const persistedCheck = await insertHealthCheck({
        serverId: server.id,
        checkType: check.id,
        status: "failed",
        summary: failureSummary,
        rawOutput: {
          error: failureSummary,
        },
      });
      await syncIncidentForCheck(persistedCheck);
      persisted.push(persistedCheck);
    }
  }

  return persisted;
}

export async function runChecksForAllActiveServers(): Promise<CheckRunSummary[]> {
  const servers = await listActiveMonitoredServerRuntimeRecords();
  const summary: CheckRunSummary[] = [];

  for (const server of servers) {
    try {
      const created = await runChecksForServer(server);
      summary.push({
        serverId: server.id,
        checksCreated: created.length,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          ok: false,
          event: "checks.server.failed",
          serverId: server.id,
          error: error instanceof Error ? error.message : "Check run failed for server",
        }),
      );
    }
  }

  return summary;
}
