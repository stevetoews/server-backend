import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_BASE_URL: z.string().url().default("http://localhost:4000"),
  FRONTEND_BASE_URL: z.string().url().default("http://localhost:3000"),
  TURSO_DATABASE_URL: z.string().min(1, "TURSO_DATABASE_URL is required"),
  TURSO_AUTH_TOKEN: z.string().min(1, "TURSO_AUTH_TOKEN is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email("BOOTSTRAP_ADMIN_EMAIL must be a valid email"),
  BOOTSTRAP_ADMIN_PASSWORD: z
    .string()
    .min(16, "BOOTSTRAP_ADMIN_PASSWORD must be at least 16 characters"),
  SSH_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  SSH_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  CHECK_SCHEDULE_CRON: z.string().default("*/5 * * * *"),
  REMEDIATION_MAX_REBOOTS_PER_24H: z.coerce.number().int().min(0).default(1),
  LINODE_API_TOKEN: z.string().optional(),
  DIGITALOCEAN_API_TOKEN: z.string().optional(),
  SPINUPWP_API_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

  throw new Error(`Invalid environment configuration: ${JSON.stringify(issues)}`);
}

export const env = parsed.data;
export type AppEnv = typeof env;
