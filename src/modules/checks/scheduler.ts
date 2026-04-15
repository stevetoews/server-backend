import cron from "node-cron";

import { env } from "../../config/env.js";
import { runChecksForAllActiveServers } from "./service.js";

let schedulerStarted = false;
let runInProgress = false;

async function runScheduledChecks() {
  if (runInProgress) {
    return;
  }

  runInProgress = true;

  try {
    const summary = await runChecksForAllActiveServers();
    console.log(
      JSON.stringify({
        ok: true,
        event: "checks.scheduler.run",
        checkedServers: summary.length,
        summary,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        event: "checks.scheduler.failed",
        error: error instanceof Error ? error.message : "Scheduled checks failed",
      }),
    );
  } finally {
    runInProgress = false;
  }
}

export function startCheckScheduler() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  cron.schedule(env.CHECK_SCHEDULE_CRON, () => {
    void runScheduledChecks();
  });
}
