# Backend

Node.js 22+ TypeScript API and worker scaffold for the internal server maintenance platform.

## Current scope

- REST endpoints for health, servers, and integrations
- Turso/libSQL client bootstrap
- SSH-first onboarding flow scaffold
- Linode and DigitalOcean provider matching scaffold
- SpinupWP adapter placeholder for post-match mapping
- Deterministic checks, policy engine, and audit logging scaffolds

## Product constraints baked into v1

- GPT/Codex target only, no Claude dependency
- SSH-first onboarding
- Provider match to Linode or DigitalOcean required before activation
- SpinupWP mapping only after provider match
- Strict SSH and WP-CLI command allowlists
- Deterministic monitoring/remediation first, AI only later for summaries
- No plaintext secrets in logs or frontend payloads

## Environment

Copy `.env.example` to `.env` and provide real values:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `SESSION_SECRET`
- optional provider tokens for Linode, DigitalOcean, and SpinupWP

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`

## API surface

- `GET /health`
- `GET /servers`
- `POST /servers`
- `POST /servers/:id/activate`
- `GET /integrations`
- `POST /integrations`

## Onboarding flow reflected in the server route

1. Create a draft server record
2. Test SSH connectivity
3. Discover host metadata
4. Fetch and rank Linode/DigitalOcean provider candidates
5. Require explicit provider confirmation before activation
6. Allow SpinupWP mapping after provider confirmation
7. Start deterministic checks once active

## Migrations

SQL migrations live in `migrations/`:

- `001_initial.sql`
- `002_indexes.sql`

## Notes

- Provider adapters return mocked data for now but are structured for real API integration.
- The in-memory route storage is intentionally temporary and should be replaced by repository modules backed by Turso.
