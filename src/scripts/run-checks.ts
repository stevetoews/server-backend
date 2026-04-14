import { runChecksForAllActiveServers } from "../modules/checks/service.js";

const summary = await runChecksForAllActiveServers();

console.log(
  JSON.stringify({
    ok: true,
    summary,
  }),
);
