import { env } from "../../config/env.js";
import type { PrimaryProviderAdapter, ProviderInstance } from "./base.js";

interface LinodeInstanceResponse {
  data: Array<{
    id: number;
    ipv4: string[];
    label: string;
    region: string;
  }>;
}

export class LinodeAdapter implements PrimaryProviderAdapter {
  kind = "linode" as const;

  private async request<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
    if (!env.LINODE_API_TOKEN) {
      throw new Error("LINODE_API_TOKEN is not configured");
    }

    const response = await fetch(`https://api.linode.com/v4${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.LINODE_API_TOKEN}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const payload = await response.text();
      throw new Error(`Linode API request failed (${response.status}): ${payload}`);
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    return (await response.json()) as TResponse;
  }

  async findCandidateInstances(input: {
    hostname: string;
    ipAddress?: string;
  }): Promise<ProviderInstance[]> {
    const payload = await this.request<LinodeInstanceResponse>("/linode/instances?page=1&page_size=100");

    const normalizedHostname = input.hostname.toLowerCase();

    return payload.data
      .filter((instance) => {
        const ipMatch = input.ipAddress ? instance.ipv4.includes(input.ipAddress) : false;
        const labelMatch = instance.label.toLowerCase().includes(normalizedHostname);

        return ipMatch || labelMatch;
      })
      .map((instance) => ({
        id: String(instance.id),
        displayName: instance.label,
        ipv4: instance.ipv4,
        provider: "linode" as const,
        region: instance.region,
      }));
  }

  async rebootInstance(instanceId: string): Promise<{ accepted: boolean; rebootId: string }> {
    await this.request(`/linode/instances/${instanceId}/reboot`, {
      method: "POST",
    });

    return {
      accepted: true,
      rebootId: `linode-reboot:${instanceId}:${Date.now()}`,
    };
  }
}
