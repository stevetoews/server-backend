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

export type SshAuthMode = "password" | "private_key" | "passwordless_agent";

export interface SshConnectionTarget {
  host: string;
  port: number;
  username: string;
}

export interface SshCredentials {
  authMode: SshAuthMode;
  password?: string;
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

export interface SshCommandResult {
  durationMs: number;
  exitCode: number | null;
  signal?: string;
  stderr: string;
  stdout: string;
}
