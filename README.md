# Backend

Node.js 22+ TypeScript API and worker scaffold for the internal server maintenance platform.

## Current scope

- REST endpoints for health, servers, integrations, and notifications
- Turso/libSQL client bootstrap
- SSH-first onboarding with live SSH verification and host discovery
- Linode provider matching with real API-backed snapshots
- Live deterministic host/service checks, WordOps inspection, policy engine, audit logging, and notifications

## Product constraints baked into v1

- GPT/Codex target only, no Claude dependency
- SSH-first onboarding
- Auto-activate after successful SSH and host discovery
- Strict SSH command allowlists
- Deterministic monitoring/remediation first, AI only later for summaries
- No plaintext secrets in logs or frontend payloads

## Environment

Copy `.env.example` to `.env` and provide real values:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `SESSION_SECRET`
- optional provider tokens for Linode and DigitalOcean
- optional SMTP settings for notification delivery

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`

## API surface

- `GET /health`
- `GET /servers`
- `POST /servers`
- `GET /servers/:id/wordops`
- `POST /servers/:id/wordops/sync`
- `GET /servers/:id/sites`
- `GET /integrations`
- `POST /integrations`
- `GET /notifications/targets`
- `POST /notifications/targets`
- `POST /notifications/targets/:id`
- `GET /notifications/deliveries`
- `GET /notifications/targets/:id/deliveries`
- `POST /notifications/targets/:id/test`
- `POST /notifications/targets/:id/delete`
- `GET /audit/logs`
- `GET /activity`
- `GET /servers/:id/activity`

## Onboarding flow reflected in the server route

1. Create a server record
2. Test SSH connectivity
3. Discover host metadata
4. Fetch and rank Linode/DigitalOcean provider candidates
5. Persist provider metadata as read-only context when available
6. Activate immediately and start scheduled checks

## Migrations

SQL migrations live in `migrations/`:

- `001_initial.sql`
- `002_indexes.sql`
- `003_incident_check_type.sql`
- `004_incident_pending_status.sql`
- `005_notifications.sql`
- `006_notification_delivery_transport.sql`
- `007_notification_targets_unique.sql`
- `008_server_ssh_credentials.sql`

## Notes

- DigitalOcean provider matching remains secondary to the Akamai/Linode-first MVP.
- SSH passwords are stored encrypted at rest and never returned by the API.
- Notification delivery uses SMTP when configured and falls back to simulated delivery in local/dev environments.
