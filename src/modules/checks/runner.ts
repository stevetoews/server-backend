import { checkCatalog } from "./catalog.js";

export interface CheckResult {
  checkId: string;
  status: "healthy" | "degraded" | "failed";
  summary: string;
}

export async function runDeterministicChecks(): Promise<CheckResult[]> {
  return checkCatalog.map((check) => ({
    checkId: check.id,
    status: "healthy",
    summary: `${check.description} (mocked v1 result)`,
  }));
}
