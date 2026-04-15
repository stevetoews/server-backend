import { getServerRuntimeById, type ServerRuntimeRecord } from "../../db/repositories/servers.js";
import { decryptSecret } from "../security/secrets.js";
import { executeSshCommand } from "../ssh/client.js";
import type { SshCredentials, SshConnectionTarget } from "../ssh/types.js";

export interface WordopsSiteSummary {
  appType: string;
  cacheType?: string;
  domain: string;
  phpVersion?: string;
  sitePath: string;
}

export interface WordopsOverview {
  infoOutput?: string;
  installed: boolean;
  siteListOutput?: string;
  sites: WordopsSiteSummary[];
  stack: {
    mysqlInstalled: boolean;
    nginxInstalled: boolean;
    phpInstalled: boolean;
    wpCliInstalled: boolean;
  };
  status: "ready" | "missing" | "degraded" | "error";
  version?: string;
}

export interface WordopsMutationResult {
  output: string;
  status: "succeeded" | "failed";
}

export interface WordopsSiteCreateInput {
  adminEmail?: string;
  adminPassword?: string;
  adminUser?: string;
  cacheProfile: "wp" | "wpfc" | "wpredis" | "wpsc" | "wprocket" | "wpce";
  domain: string;
  hsts?: boolean;
  letsEncrypt?: boolean;
  phpVersion?: "8.2" | "8.3";
  vhostOnly?: boolean;
}

export interface WordopsStackInstallInput {
  profile: "web";
}

function getServerSshTarget(server: ServerRuntimeRecord): SshConnectionTarget {
  return {
    host: server.ipAddress ?? server.hostname,
    port: server.sshPort,
    username: server.sshUsername,
  };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function getServerSshCredentials(server: ServerRuntimeRecord): SshCredentials {
  if (server.sshAuthMode === "password") {
    if (!server.encryptedSshPassword) {
      throw new Error("No encrypted SSH password is stored for this server");
    }

    return {
      authMode: "password",
      password: decryptSecret(server.encryptedSshPassword),
    };
  }

  if (server.sshAuthMode === "passwordless_agent") {
    return {
      authMode: "passwordless_agent",
    };
  }

  throw new Error(`SSH auth mode ${server.sshAuthMode} is not supported in the MVP`);
}

function parseWordopsVersion(output: string): string | undefined {
  const match = output.match(/wordops(?:\s+version)?[:\s]+v?([0-9][\w.-]*)/i);
  return match?.[1];
}

function parseWordopsStackState(infoOutput: string): WordopsOverview["stack"] {
  const normalized = infoOutput.toLowerCase();
  const phpMissingPatterns = [
    "php 7.4 is not installed",
    "php 8.0 is not installed",
    "php 8.1 is not installed",
    "php 8.2 is not installed",
    "php 8.3 is not installed",
    "php 8.4 is not installed",
  ];
  const phpInstalled = phpMissingPatterns.some((pattern) => !normalized.includes(pattern));

  return {
    mysqlInstalled:
      !normalized.includes("mysql is not installed") && !normalized.includes("mariadb is not installed"),
    nginxInstalled: !normalized.includes("nginx is not installed"),
    phpInstalled,
    wpCliInstalled: !normalized.includes("wp-cli is not installed"),
  };
}

function inferCacheType(value: string): string | undefined {
  const normalized = value.toLowerCase();

  if (normalized.includes("wpredis") || normalized.includes("redis")) {
    return "redis";
  }

  if (normalized.includes("wpfc") || normalized.includes("fastcgi")) {
    return "fastcgi_cache";
  }

  if (normalized.includes("wpsc") || normalized.includes("super-cache")) {
    return "wp_super_cache";
  }

  if (normalized.includes("wprocket") || normalized.includes("rocket")) {
    return "wp_rocket";
  }

  if (normalized.includes("wpce") || normalized.includes("cache-enabler")) {
    return "cache_enabler";
  }

  if (normalized.includes("wp")) {
    return "wordpress";
  }

  return undefined;
}

function inferAppType(value: string): string {
  const normalized = value.toLowerCase();

  if (normalized.includes("wp")) {
    return "wordpress";
  }

  if (normalized.includes("html")) {
    return "html";
  }

  if (normalized.includes("proxy")) {
    return "proxy";
  }

  if (normalized.includes("php")) {
    return "php";
  }

  if (normalized.includes("mysql")) {
    return "mysql";
  }

  return value.trim() || "unknown";
}

function extractPhpVersion(columns: string[]): string | undefined {
  for (const column of columns) {
    const match = column.match(/php\s*([0-9]+\.[0-9]+)/i) ?? column.match(/^([0-9]+\.[0-9]+)$/);

    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function parseWordopsSites(output: string): WordopsSiteSummary[] {
  const lines = output
    .split("\n")
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);

  const siteRows: WordopsSiteSummary[] = [];

  for (const line of lines) {
    const normalized = line.toLowerCase();

    if (
      normalized === "wo site list" ||
      normalized.startsWith("usage:") ||
      normalized.startsWith("list all sites") ||
      /^[\-\+=| ]+$/.test(line) ||
      normalized.includes("site type") ||
      normalized.includes("site_name")
    ) {
      continue;
    }

    const columns = line
      .split(/\s{2,}/)
      .map((column) => column.trim())
      .filter(Boolean);

    const domain = columns[0];

    if (!domain || !/[a-z0-9.-]+\.[a-z]{2,}/i.test(domain)) {
      continue;
    }

    const sitePath = columns.find((column) => column.startsWith("/var/www")) ?? `/var/www/${domain}`;
    const appTypeSource = columns.find((column) => /wp|html|php|mysql|proxy/i.test(column)) ?? "unknown";
    const appType = inferAppType(appTypeSource);
    const cacheType = columns
      .map((column) => inferCacheType(column))
      .find((value) => typeof value === "string");
    const phpVersion = extractPhpVersion(columns);

    const site: WordopsSiteSummary = {
      domain,
      sitePath,
      appType,
      ...(cacheType ? { cacheType } : {}),
      ...(phpVersion ? { phpVersion } : {}),
    };

    siteRows.push(site);
  }

  return siteRows;
}

async function executeWordopsCommand(server: ServerRuntimeRecord, command: string) {
  return executeSshCommand({
    command,
    credentials: getServerSshCredentials(server),
    target: getServerSshTarget(server),
  });
}

async function getRuntimeServer(serverId: string): Promise<ServerRuntimeRecord> {
  const server = await getServerRuntimeById(serverId);

  if (!server) {
    throw new Error("Server runtime record was not found");
  }

  return server;
}

async function executeWordopsMutation(serverId: string, commandParts: string[]): Promise<WordopsMutationResult> {
  const server = await getRuntimeServer(serverId);
  const command = commandParts.join(" ");
  const execution = await executeWordopsCommand(server, `sh -lc ${shellEscape(`${command} 2>&1`)}`);
  const output = [execution.stdout, execution.stderr].filter(Boolean).join("\n").trim();

  return {
    output: output || command,
    status: execution.exitCode === 0 ? "succeeded" : "failed",
  };
}

export async function inspectServerWordops(serverId: string): Promise<WordopsOverview> {
  const server = await getRuntimeServer(serverId);

  const probe = await executeWordopsCommand(
    server,
    "sh -lc 'if command -v wo >/dev/null 2>&1; then printf \"installed=1\\n\"; else printf \"installed=0\\n\"; fi'",
  );

  if (!probe.stdout.includes("installed=1")) {
    return {
      installed: false,
      sites: [],
      stack: {
        mysqlInstalled: false,
        nginxInstalled: false,
        phpInstalled: false,
        wpCliInstalled: false,
      },
      status: "missing",
    };
  }

  const [infoResult, siteListResult] = await Promise.all([
    executeWordopsCommand(server, "sh -lc 'wo info 2>&1'"),
    executeWordopsCommand(server, "sh -lc 'wo site list 2>&1'"),
  ]);
  const infoOutput = [infoResult.stdout, infoResult.stderr].filter(Boolean).join("\n").trim();
  const siteListOutput = [siteListResult.stdout, siteListResult.stderr].filter(Boolean).join("\n").trim();
  const stack = parseWordopsStackState(infoOutput);
  const status =
    infoResult.exitCode !== 0 || siteListResult.exitCode !== 0
      ? "error"
      : stack.nginxInstalled && stack.mysqlInstalled && stack.phpInstalled
        ? "ready"
        : "degraded";

  const version = parseWordopsVersion(infoOutput);

  return {
    infoOutput,
    installed: true,
    siteListOutput,
    sites: parseWordopsSites(siteListOutput),
    stack,
    status,
    ...(version ? { version } : {}),
  };
}

export async function createWordopsSite(
  serverId: string,
  input: WordopsSiteCreateInput,
): Promise<WordopsMutationResult> {
  const commandParts = [
    "wo",
    "site",
    "create",
    shellEscape(input.domain),
    `--${input.cacheProfile}`,
  ];

  if (input.letsEncrypt) {
    commandParts.push("--letsencrypt");
  }

  if (input.hsts) {
    commandParts.push("--hsts");
  }

  if (input.vhostOnly) {
    commandParts.push("--vhostonly");
  }

  if (input.phpVersion === "8.2") {
    commandParts.push("--php82");
  }

  if (input.phpVersion === "8.3") {
    commandParts.push("--php83");
  }

  if (input.adminUser) {
    commandParts.push(`--user=${shellEscape(input.adminUser)}`);
  }

  if (input.adminPassword) {
    commandParts.push(`--pass=${shellEscape(input.adminPassword)}`);
  }

  if (input.adminEmail) {
    commandParts.push(`--email=${shellEscape(input.adminEmail)}`);
  }

  return executeWordopsMutation(serverId, commandParts);
}

export async function enableWordopsSite(serverId: string, domain: string): Promise<WordopsMutationResult> {
  return executeWordopsMutation(serverId, ["wo", "site", "enable", shellEscape(domain)]);
}

export async function disableWordopsSite(serverId: string, domain: string): Promise<WordopsMutationResult> {
  return executeWordopsMutation(serverId, ["wo", "site", "disable", shellEscape(domain)]);
}

export async function deleteWordopsSite(serverId: string, domain: string): Promise<WordopsMutationResult> {
  return executeWordopsMutation(serverId, [
    "wo",
    "site",
    "delete",
    shellEscape(domain),
    "--no-prompt",
  ]);
}

export async function installWordopsStack(
  serverId: string,
  input: WordopsStackInstallInput,
): Promise<WordopsMutationResult> {
  if (input.profile !== "web") {
    throw new Error(`Unsupported WordOps stack profile ${input.profile}`);
  }

  return executeWordopsMutation(serverId, ["wo", "stack", "install", "--web"]);
}
