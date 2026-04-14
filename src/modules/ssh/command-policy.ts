import type { CommandTemplate } from "./types.js";

export const allowedCommandTemplates: readonly CommandTemplate[] = [
  { id: "check.host.uptime", category: "status_check", command: "uptime" },
  { id: "check.disk.usage", category: "status_check", command: "df -h /" },
  { id: "check.memory", category: "status_check", command: "free -m" },
  { id: "check.load", category: "status_check", command: "cat /proc/loadavg" },
  { id: "check.nginx.status", category: "status_check", command: "systemctl status nginx --no-pager" },
  { id: "check.mysql.status", category: "status_check", command: "systemctl status mysql --no-pager" },
  { id: "check.phpfpm.status", category: "status_check", command: "systemctl status php8.2-fpm --no-pager" },
  { id: "fix.nginx.restart", category: "service_restart", command: "systemctl restart nginx" },
  { id: "fix.mysql.restart", category: "service_restart", command: "systemctl restart mysql" },
  { id: "fix.phpfpm.restart", category: "service_restart", command: "systemctl restart php8.2-fpm" },
  { id: "wp.core.isInstalled", category: "wordpress_maintenance", command: "wp core is-installed --quiet" },
  { id: "wp.option.home", category: "wordpress_maintenance", command: "wp option get home" },
  { id: "wp.option.siteurl", category: "wordpress_maintenance", command: "wp option get siteurl" },
  { id: "wp.cache.flush", category: "wordpress_maintenance", command: "wp cache flush" },
  { id: "wp.transients.deleteAll", category: "wordpress_maintenance", command: "wp transient delete --all" },
  { id: "wp.cron.runDue", category: "wordpress_maintenance", command: "wp cron event run --due-now" },
];

const templateIndex = new Map(allowedCommandTemplates.map((template) => [template.id, template]));

export function getAllowedCommandTemplate(templateId: string): CommandTemplate | undefined {
  return templateIndex.get(templateId);
}

export function assertAllowedCommandTemplate(templateId: string): CommandTemplate {
  const template = getAllowedCommandTemplate(templateId);

  if (!template) {
    throw new Error(`Command template ${templateId} is not allowed`);
  }

  return template;
}
