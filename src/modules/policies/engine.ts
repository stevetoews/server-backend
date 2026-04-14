import type { ProviderMatch, ServerRecord } from "../contracts/server.js";

export interface PolicyDecision {
  action: "allow" | "deny";
  reasons: string[];
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
