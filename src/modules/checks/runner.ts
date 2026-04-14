import { runChecksForAllActiveServers, runChecksForServer } from "./service.js";

export async function runDeterministicChecks() {
  return runChecksForAllActiveServers();
}

export async function runDeterministicChecksForServer(serverId: string) {
  throw new Error(`runDeterministicChecksForServer(${serverId}) should not be called directly without loading the server`);
}
