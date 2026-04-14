import type { PrimaryProviderAdapter, ProviderInstance } from "./base.js";

export class DigitalOceanAdapter implements PrimaryProviderAdapter {
  kind = "digitalocean" as const;

  async findCandidateInstances(input: {
    hostname: string;
    ipAddress?: string;
  }): Promise<ProviderInstance[]> {
    return [
      {
        id: "do-456",
        displayName: `${input.hostname}-droplet`,
        ipv4: input.ipAddress ? [input.ipAddress] : ["198.51.100.25"],
        provider: "digitalocean",
        region: "tor1",
      },
    ];
  }

  async rebootInstance(instanceId: string): Promise<{ accepted: boolean; rebootId: string }> {
    return {
      accepted: true,
      rebootId: `do-reboot:${instanceId}`,
    };
  }
}
