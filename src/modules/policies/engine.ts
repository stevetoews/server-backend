import type { IncidentRecord } from "../../db/repositories/incidents.js";
import type { RemediationActionDefinition } from "../remediation/catalog.js";
import type { ProviderMatch, ServerRecord } from "../contracts/server.js";

export interface PolicyDecision {
  action: "allow" | "deny";
  reasons: string[];
}

export interface RemediationPolicyDecision extends PolicyDecision {
  actionType: string;
}

export function evaluateActivationPolicy(server: Pick<ServerRecord, "onboardingStatus"> & {
  providerMatch?: ProviderMatch;
}): PolicyDecision {
  if (!server.providerMatch) {
    return {
      action: "deny",
      reasons: ["Provider matching to Linode or DigitalOcean is required before activation"],
    };
  }

  if (server.onboardingStatus !== "provider_matched" && server.onboardingStatus !== "active") {
    return {
      action: "deny",
      reasons: ["SSH verification and host discovery must complete before activation"],
    };
  }

  return {
    action: "allow",
    reasons: ["Server has completed required onboarding gates"],
  };
}

export function evaluateRemediationPolicy(input: {
  action: RemediationActionDefinition;
  incident: Pick<IncidentRecord, "status">;
  server: Pick<ServerRecord, "onboardingStatus" | "providerMatch" | "spinupwpServerId">;
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

  if (
    input.action.actionType.startsWith("wordpress.") &&
    !input.server.spinupwpServerId
  ) {
    return {
      action: "deny",
      actionType: input.action.actionType,
      reasons: ["WordPress remediations require an active SpinupWP mapping"],
    };
  }

  return {
    action: "allow",
    actionType: input.action.actionType,
    reasons: ["Remediation action is allowlisted for the current server state"],
  };
}
