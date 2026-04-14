# Backend module plan

## modules/ssh
- test connection
- run allowlisted commands
- discover server metadata

## modules/providers/linode
- list instances
- match instance by IP / label / hostname
- reboot instance

## modules/providers/digitalocean
- list droplets
- match droplet by IP / name
- reboot droplet

## modules/providers/spinupwp
- list servers
- list sites
- restart supported services
- match server/site after provider mapping

## modules/checks
- http
- ssh
- disk
- memory
- load
- mysql
- nginx
- phpfpm
- wordpress

## modules/policies
- evaluate failures
- suggest next action
- approve or block action

## modules/audit
- create audit entries
- redact sensitive output
