import { executeSshCommand, probeSshConnection } from "./client.js";
import type {
  HostDiscovery,
  SshConnectionTarget,
  SshCredentials,
  SshProbeResult,
} from "./types.js";

const DISCOVERY_COMMAND = [
  "hostname_value=$(hostname 2>/dev/null || echo unknown)",
  "arch_value=$(uname -m 2>/dev/null || echo unknown)",
  "kernel_value=$(uname -r 2>/dev/null || echo unknown)",
  "if [ -r /etc/os-release ]; then . /etc/os-release; distro_value=\"${NAME:-Linux} ${VERSION_ID:-${VERSION:-}}\"; else distro_value=$(uname -s 2>/dev/null || echo Linux); fi",
  "primary_ip_value=$(hostname -I 2>/dev/null | awk '{print $1}')",
  "printf 'hostname=%s\\narchitecture=%s\\nkernel=%s\\ndistro=%s\\nprimaryIp=%s\\n' \"$hostname_value\" \"$arch_value\" \"$kernel_value\" \"$distro_value\" \"$primary_ip_value\"",
].join("; ");

function parseKeyValueLines(stdout: string): Record<string, string> {
  return stdout.split("\n").reduce<Record<string, string>>((accumulator, line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return accumulator;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      return accumulator;
    }

    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1).trim();
    accumulator[key] = value;
    return accumulator;
  }, {});
}

export async function testSshConnection(
  target: SshConnectionTarget,
  credentials: SshCredentials,
): Promise<SshProbeResult> {
  const probe = await probeSshConnection({
    target,
    credentials,
  });

  return {
    ...probe,
    target,
  };
}

export async function discoverHostMetadata(
  target: SshConnectionTarget,
  credentials: SshCredentials,
): Promise<HostDiscovery> {
  const result = await executeSshCommand({
    command: DISCOVERY_COMMAND,
    credentials,
    target,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Host discovery command failed");
  }

  const metadata = parseKeyValueLines(result.stdout);

  return {
    architecture: metadata.architecture || "unknown",
    distro: metadata.distro || "unknown",
    hostname: metadata.hostname || target.host,
    kernelVersion: metadata.kernel || "unknown",
    ...(metadata.primaryIp ? { primaryIp: metadata.primaryIp } : {}),
  };
}
