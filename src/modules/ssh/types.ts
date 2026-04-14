export type CommandCategory =
  | "status_check"
  | "service_restart"
  | "wordpress_maintenance"
  | "provider_reboot";

export interface CommandTemplate {
  category: CommandCategory;
  command: string;
  id: string;
}

export interface SshConnectionTarget {
  host: string;
  port: number;
  username: string;
}

export interface HostDiscovery {
  architecture: string;
  distro: string;
  hostname: string;
  kernelVersion: string;
  primaryIp?: string;
}

export interface SshProbeResult {
  latencyMs: number;
  ok: boolean;
  target: SshConnectionTarget;
}
