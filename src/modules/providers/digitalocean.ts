import { env } from "../../config/env.js";
import type { PrimaryProviderAdapter, ProviderInstance } from "./base.js";

export class DigitalOceanAdapter implements PrimaryProviderAdapter {
  kind = "digitalocean" as const;

  async findCandidateInstances(input: {
    hostname: string;
    ipAddress?: string;
  }): Promise<ProviderInstance[]> {
    void input;

    if (!env.DIGITALOCEAN_API_TOKEN) {
      return [];
    }

    // DO integration remains intentionally conservative until a real API adapter is added.
    return [];
  }

  async rebootInstance(instanceId: string): Promise<{ accepted: boolean; rebootId: string }> {
    throw new Error(`DigitalOcean reboot is not implemented for instance ${instanceId}`);
  }
}
