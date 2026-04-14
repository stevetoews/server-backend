import { z } from "zod";

export const integrationKindSchema = z.enum(["linode", "digitalocean", "spinupwp"]);
export type IntegrationKind = z.infer<typeof integrationKindSchema>;

export const onboardingStatusSchema = z.enum([
  "draft",
  "ssh_verified",
  "discovered",
  "provider_matched",
  "active",
]);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

export const serverDraftSchema = z.object({
  name: z.string().min(2).max(80),
  environment: z.enum(["production", "staging", "development"]),
  hostname: z.string().min(1).max(255),
  ipAddress: z.string().ip().optional(),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUsername: z.string().min(1).max(64),
  sshAuthMode: z.enum(["private_key", "passwordless_agent"]),
  notes: z.string().max(1000).optional(),
});
export type ServerDraftInput = z.infer<typeof serverDraftSchema>;

export const providerMatchSchema = z.object({
  providerKind: z.enum(["linode", "digitalocean"]),
  providerInstanceId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).min(1),
});
export type ProviderMatch = z.infer<typeof providerMatchSchema>;

export const sshProbeSchema = z.object({
  latencyMs: z.number(),
  ok: z.boolean(),
  target: z.object({
    host: z.string(),
    port: z.number(),
    username: z.string(),
  }),
});
export type SshProbe = z.infer<typeof sshProbeSchema>;

export const hostDiscoverySchema = z.object({
  architecture: z.string(),
  distro: z.string(),
  hostname: z.string(),
  kernelVersion: z.string(),
  primaryIp: z.string().optional(),
});
export type HostDiscovery = z.infer<typeof hostDiscoverySchema>;

export const serverRecordSchema = serverDraftSchema.extend({
  id: z.string(),
  onboardingStatus: onboardingStatusSchema,
  providerMatch: providerMatchSchema.optional(),
  spinupwpServerId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ServerRecord = z.infer<typeof serverRecordSchema>;

export const onboardingSnapshotSchema = z.object({
  ssh: sshProbeSchema,
  discovery: hostDiscoverySchema,
  providerMatches: z.array(providerMatchSchema),
  nextStep: z.string(),
});
export type OnboardingSnapshot = z.infer<typeof onboardingSnapshotSchema>;
