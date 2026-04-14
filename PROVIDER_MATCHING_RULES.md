# Provider Matching Rules

Provider matching is required before a server can become active.

## Required primary provider
One of:
- Linode
- DigitalOcean

## Matching signals
Use weighted scoring:
1. Public IP exact match
2. Hostname exact match
3. Provider label/name similarity
4. Reverse DNS / FQDN similarity

## Workflow
1. SSH discovery succeeds
2. Fetch candidate provider instances
3. Rank candidates
4. Admin confirms match
5. Save provider kind + provider instance id
6. Only then allow SpinupWP mapping
