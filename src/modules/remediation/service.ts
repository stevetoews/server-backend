import { assertAllowedCommandTemplate } from "../ssh/command-policy.js";
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

  const commandTemplate = assertAllowedCommandTemplate(action.allowedCommandTemplateId ?? "");

  return {
    provider: "ssh",
    commandText: commandTemplate.command,
    status: "succeeded",
    outputSnippet: `Simulated allowlisted execution: ${commandTemplate.command}`,
    response: {
      commandTemplateId: commandTemplate.id,
      simulated: true,
    },
  };
}
