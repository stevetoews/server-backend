# Provider Matching Rules

Provider matching enriches server inventory and reboot workflows. It is no longer an activation gate.

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
4. Save the best provider kind + provider instance id when confidence is acceptable
5. Surface provider metadata as read-only context in the UI
6. Use the saved provider instance only for provider-native actions such as reboot
