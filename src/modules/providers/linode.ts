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

interface LinodeTypeResponse {
  data: Array<{
    disk: number;
    id: string;
    label: string;
    memory: number;
    vcpus: number;
  }>;
}

interface LinodeRegionResponse {
  data: Array<{
    id: string;
    label: string;
  }>;
}

export interface LinodeInstanceDetails {
  created: string;
  id: number;
  ipv4: string[];
  ipv6: string;
  label: string;
  region: string;
  specs: {
    disk: number;
    memory: number;
    vcpus: number;
  };
  tags: string[];
  type: string;
}

export interface LinodeSnapshot {
  kind: "linode";
  linodeId: string;
  summary: string;
  planLabel: string;
  cpuCores: number;
  ramGb: number;
  totalStorageGb: number;
  usedStoragePercent?: number;
  publicIpv4: string[];
  publicIpv6: string[];
  region: string;
  tags: string[];
  createdAt: string;
}

export class LinodeAdapter implements PrimaryProviderAdapter {
  kind = "linode" as const;
  private static typesCache: Promise<LinodeTypeResponse> | null = null;
  private static regionsCache: Promise<LinodeRegionResponse> | null = null;

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

  private async getTypes(): Promise<LinodeTypeResponse> {
    if (!LinodeAdapter.typesCache) {
      LinodeAdapter.typesCache = this.request<LinodeTypeResponse>("/linode/types?page=1&page_size=100");
    }

    return LinodeAdapter.typesCache;
  }

  private async getRegions(): Promise<LinodeRegionResponse> {
    if (!LinodeAdapter.regionsCache) {
      LinodeAdapter.regionsCache = this.request<LinodeRegionResponse>("/regions?page=1&page_size=100");
    }

    return LinodeAdapter.regionsCache;
  }

  async getInstance(instanceId: string): Promise<LinodeInstanceDetails> {
    return this.request<LinodeInstanceDetails>(`/linode/instances/${instanceId}`);
  }

  async buildSnapshot(instanceId: string): Promise<LinodeSnapshot> {
    const [instance, types, regions] = await Promise.all([
      this.getInstance(instanceId),
      this.getTypes(),
      this.getRegions(),
    ]);
    const typeDetails = types.data.find((type) => type.id === instance.type);
    const regionDetails = regions.data.find((region) => region.id === instance.region);
    const ramGb = Number((instance.specs.memory / 1024).toFixed(1));
    const totalStorageGb = Number((instance.specs.disk / 1024).toFixed(1));

    return {
      kind: "linode",
      linodeId: String(instance.id),
      summary: `${instance.label} on ${typeDetails?.label ?? instance.type}`,
      planLabel: typeDetails?.label ?? instance.type,
      cpuCores: instance.specs.vcpus,
      ramGb,
      totalStorageGb,
      publicIpv4: instance.ipv4,
      publicIpv6: instance.ipv6 ? [instance.ipv6] : [],
      region: regionDetails?.label ?? instance.region,
      tags: instance.tags,
      createdAt: instance.created,
    };
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
