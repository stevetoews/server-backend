import { getServerRuntimeById } from "../../db/repositories/servers.js";
import { decryptSecret } from "../security/secrets.js";
import { assertAllowedCommandTemplate } from "../ssh/command-policy.js";
import { executeSshCommand } from "../ssh/client.js";
import type { IncidentRecord } from "../../db/repositories/incidents.js";
import type { ServerRecord } from "../contracts/server.js";
import { LinodeAdapter } from "../providers/linode.js";
import { getRemediationActionByType } from "./catalog.js";

export async function executeRemediation(input: {
  actionType: string;
  incident: IncidentRecord;
  server: ServerRecord;
}): Promise<{
  commandText?: string;
  outputSnippet: string;
  provider: string;
  response?: Record<string, unknown>;
  status: "succeeded" | "failed";
}> {
  const action = getRemediationActionByType(input.actionType);

  if (!action) {
    throw new Error(`Unsupported remediation action ${input.actionType}`);
  }

  if (action.provider === "linode") {
    if (!input.server.providerMatch || input.server.providerMatch.providerKind !== "linode") {
      throw new Error("Provider reboot requires a matched Linode provider instance");
    }

    const reboot = await new LinodeAdapter().rebootInstance(
      input.server.providerMatch.providerInstanceId,
    );

    return {
      provider: "linode",
      status: reboot.accepted ? "succeeded" : "failed",
      outputSnippet: reboot.accepted
        ? `Linode reboot accepted for provider instance ${input.server.providerMatch.providerInstanceId}`
        : `Linode reboot was rejected for provider instance ${input.server.providerMatch.providerInstanceId}`,
      response: reboot,
    };
  }

  const runtimeServer = await getServerRuntimeById(input.server.id);

  if (!runtimeServer) {
    throw new Error("Server runtime record was not found for remediation");
  }

  if (runtimeServer.sshAuthMode !== "password") {
    throw new Error(`SSH auth mode ${runtimeServer.sshAuthMode} is not supported in the MVP`);
  }

  if (!runtimeServer.encryptedSshPassword) {
    throw new Error("No encrypted SSH password is stored for this server");
  }

  const commandTemplate = assertAllowedCommandTemplate(action.allowedCommandTemplateId ?? "");
  const execution = await executeSshCommand({
    command: commandTemplate.command,
    credentials: {
      authMode: "password",
      password: decryptSecret(runtimeServer.encryptedSshPassword),
    },
    target: {
      host: runtimeServer.ipAddress ?? runtimeServer.hostname,
      port: runtimeServer.sshPort,
      username: runtimeServer.sshUsername,
    },
  });

  const succeeded = execution.exitCode === 0;
  const outputSnippet = [execution.stdout, execution.stderr].filter(Boolean).join("\n").trim();

  return {
    provider: "ssh",
    commandText: commandTemplate.command,
    status: succeeded ? "succeeded" : "failed",
    outputSnippet: outputSnippet || `${input.actionType} ${succeeded ? "succeeded" : "failed"}`,
    response: {
      commandTemplateId: commandTemplate.id,
      exitCode: execution.exitCode,
      stderr: execution.stderr,
      stdout: execution.stdout,
    },
  };
}
