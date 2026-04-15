import type { ProviderMatch } from "../contracts/server.js";

export interface ProviderInstance {
  displayName: string;
  id: string;
  ipv4: string[];
  provider: "linode" | "digitalocean";
  region: string;
}

export interface ProviderAdapter {
  kind: "linode" | "digitalocean";
}

export interface PrimaryProviderAdapter extends ProviderAdapter {
  kind: "linode" | "digitalocean";
  findCandidateInstances(input: { hostname: string; ipAddress?: string }): Promise<ProviderInstance[]>;
  rebootInstance(instanceId: string): Promise<{ accepted: boolean; rebootId: string }>;
}

export function toProviderMatch(
  instance: ProviderInstance,
  confidence: number,
  reasons: string[],
): ProviderMatch {
  return {
    providerKind: instance.provider,
    providerInstanceId: instance.id,
    confidence,
    reasons,
  };
}
