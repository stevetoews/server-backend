import type { IncidentRecord } from "../../db/repositories/incidents.js";
import type { RemediationActionDefinition } from "../remediation/catalog.js";
import type { ServerRecord } from "../contracts/server.js";

export interface PolicyDecision {
  action: "allow" | "deny";
  reasons: string[];
}

export interface RemediationPolicyDecision extends PolicyDecision {
  actionType: string;
}

export function evaluateRemediationPolicy(input: {
  action: RemediationActionDefinition;
  incident: Pick<IncidentRecord, "status">;
  server: Pick<ServerRecord, "onboardingStatus" | "providerMatch">;
}): RemediationPolicyDecision {
  if (input.incident.status !== "open") {
    return {
      action: "deny",
      actionType: input.action.actionType,
      reasons: ["Only open incidents can be remediated"],
    };
  }

  if (input.server.onboardingStatus !== "active") {
    return {
      action: "deny",
      actionType: input.action.actionType,
      reasons: ["Server must be active before any remediation can run"],
    };
  }

  if (input.action.provider === "linode") {
    if (!input.server.providerMatch || input.server.providerMatch.providerKind !== "linode") {
      return {
        action: "deny",
        actionType: input.action.actionType,
        reasons: ["Provider reboot requires a matched Linode provider instance"],
      };
    }
  }

  return {
    action: "allow",
    actionType: input.action.actionType,
    reasons: ["Remediation action is allowlisted for the current server state"],
  };
}
