import type { HostDiscovery, SshConnectionTarget, SshProbeResult } from "./types.js";

export async function testSshConnection(target: SshConnectionTarget): Promise<SshProbeResult> {
  return {
    ok: true,
    latencyMs: 118,
    target,
  };
}

export async function discoverHostMetadata(target: SshConnectionTarget): Promise<HostDiscovery> {
  return {
    architecture: "x86_64",
    distro: "Ubuntu 24.04 LTS",
    hostname: target.host,
    kernelVersion: "6.8.0",
    primaryIp: target.host,
  };
}
