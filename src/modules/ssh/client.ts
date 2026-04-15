import { Client, type ClientChannel } from "ssh2";

import { env } from "../../config/env.js";
import type {
  SshCommandResult,
  SshConnectionTarget,
  SshCredentials,
} from "./types.js";

function buildConnectionOptions(target: SshConnectionTarget, credentials: SshCredentials) {
  if (credentials.authMode === "password") {
    if (!credentials.password) {
      throw new Error("SSH password auth requires a stored password");
    }

    return {
      host: target.host,
      port: target.port,
      readyTimeout: env.SSH_CONNECT_TIMEOUT_MS,
      username: target.username,
      password: credentials.password,
    };
  }

  if (credentials.authMode === "passwordless_agent") {
    if (!process.env.SSH_AUTH_SOCK) {
      throw new Error("SSH agent auth requires SSH_AUTH_SOCK to be available on the backend");
    }

    return {
      agent: process.env.SSH_AUTH_SOCK,
      host: target.host,
      port: target.port,
      readyTimeout: env.SSH_CONNECT_TIMEOUT_MS,
      username: target.username,
    };
  }

  throw new Error(`SSH auth mode ${credentials.authMode} is not supported in the MVP`);
}

async function connectClient(
  target: SshConnectionTarget,
  credentials: SshCredentials,
): Promise<Client> {
  const client = new Client();

  return new Promise<Client>((resolve, reject) => {
    const cleanup = () => {
      client.removeAllListeners("ready");
      client.removeAllListeners("error");
      client.removeAllListeners("end");
      client.removeAllListeners("close");
    };

    client.once("ready", () => {
      cleanup();
      resolve(client);
    });

    client.once("error", (error) => {
      cleanup();
      reject(error);
    });

    client.connect(buildConnectionOptions(target, credentials));
  });
}

export async function executeSshCommand(input: {
  command: string;
  credentials: SshCredentials;
  target: SshConnectionTarget;
}): Promise<SshCommandResult> {
  const client = await connectClient(input.target, input.credentials);
  const startedAt = Date.now();

  try {
    return await new Promise<SshCommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error(`SSH command timed out after ${env.SSH_COMMAND_TIMEOUT_MS}ms`));
      }, env.SSH_COMMAND_TIMEOUT_MS);

      client.exec(input.command, (error: Error | undefined, stream: ClientChannel) => {
        if (error) {
          clearTimeout(timeout);
          client.end();
          reject(error);
          return;
        }

        let stdout = "";
        let stderr = "";
        let exitCode: number | null = null;
        let signal: string | undefined;

        stream.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });

        stream.stderr.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });

        stream.on("exit", (code?: number, streamSignal?: string) => {
          exitCode = typeof code === "number" ? code : null;
          signal = streamSignal;
        });

        stream.on("close", () => {
          clearTimeout(timeout);
          client.end();
          resolve({
            durationMs: Date.now() - startedAt,
            exitCode,
            ...(signal ? { signal } : {}),
            stderr: stderr.trim(),
            stdout: stdout.trim(),
          });
        });
      });
    });
  } finally {
    client.end();
  }
}

export async function probeSshConnection(input: {
  credentials: SshCredentials;
  target: SshConnectionTarget;
}): Promise<{ latencyMs: number; ok: boolean }> {
  const startedAt = Date.now();
  const client = await connectClient(input.target, input.credentials);

  client.end();

  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
  };
}
