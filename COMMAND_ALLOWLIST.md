# Command Allowlist

Only named templates should be executable.

## Linux checks
- check.host.uptime
- check.disk.usage
- check.memory
- check.load
- check.nginx.status
- check.mysql.status
- check.phpfpm.status

## Linux remediations
- fix.nginx.restart
- fix.mysql.restart
- fix.phpfpm.restart

## WordPress checks
- wp.core.isInstalled
- wp.plugin.list
- wp.option.home
- wp.option.siteurl

## WordPress maintenance
- wp.cache.flush
- wp.transients.deleteAll
- wp.cron.runDue

## Forbidden
- package installs
- file deletes
- config rewrites
- arbitrary bash
- updates/upgrades
- destructive database actions
