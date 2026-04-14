import type { ProviderAdapter } from "./base.js";

export interface SpinupwpServerMapping {
  label: string;
  siteCount: number;
  spinupwpServerId: string;
}

export class SpinupwpAdapter implements ProviderAdapter {
  kind = "spinupwp" as const;

  async listServers(): Promise<SpinupwpServerMapping[]> {
    return [
      {
        spinupwpServerId: "spinupwp-789",
        label: "Primary WordPress Fleet",
        siteCount: 14,
      },
    ];
  }
}
