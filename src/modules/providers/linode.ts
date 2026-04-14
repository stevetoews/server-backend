import type { PrimaryProviderAdapter, ProviderInstance } from "./base.js";

export class LinodeAdapter implements PrimaryProviderAdapter {
  kind = "linode" as const;

  async findCandidateInstances(input: {
    hostname: string;
    ipAddress?: string;
  }): Promise<ProviderInstance[]> {
    return [
      {
        id: "linode-123",
        displayName: `${input.hostname}-linode`,
        ipv4: input.ipAddress ? [input.ipAddress] : ["203.0.113.10"],
        provider: "linode",
        region: "us-east",
      },
    ];
  }

  async rebootInstance(instanceId: string): Promise<{ accepted: boolean; rebootId: string }> {
    return {
      accepted: true,
      rebootId: `linode-reboot:${instanceId}`,
    };
  }
}
