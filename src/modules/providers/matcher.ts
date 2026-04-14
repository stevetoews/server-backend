import type { ProviderMatch } from "../contracts/server.js";
import type { PrimaryProviderAdapter } from "./base.js";
import { toProviderMatch } from "./base.js";

export async function findProviderMatches(input: {
  hostname: string;
  ipAddress?: string;
  providers: PrimaryProviderAdapter[];
}): Promise<ProviderMatch[]> {
  const candidates = await Promise.all(
    input.providers.map((provider) => provider.findCandidateInstances(input)),
  );

  return candidates
    .flat()
    .map((instance) => {
      const reasons = [];
      let confidence = 0.2;

      if (instance.ipv4.includes(input.ipAddress ?? "")) {
        reasons.push("Public IP matched an instance IPv4 address");
        confidence += 0.55;
      }

      if (instance.displayName.toLowerCase().includes(input.hostname.toLowerCase())) {
        reasons.push("Provider instance name resembles the discovered hostname");
        confidence += 0.2;
      }

      reasons.push(`Provider candidate located in ${instance.region}`);

      return toProviderMatch(instance, Math.min(confidence, 0.99), reasons);
    })
    .sort((left, right) => right.confidence - left.confidence);
}
