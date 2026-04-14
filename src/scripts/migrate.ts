import { runMigrations } from "../db/migrations.js";

const applied = await runMigrations();

console.log(
  JSON.stringify({
    ok: true,
    applied,
  }),
);
