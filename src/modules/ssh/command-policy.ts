import type { CommandTemplate } from "./types.js";

export const allowedCommandTemplates: readonly CommandTemplate[] = [
  { id: "check.host.uptime", category: "status_check", command: "uptime" },
  { id: "check.disk.root", category: "status_check", command: "df -Pk /" },
  {
    id: "check.service.nginx",
    category: "status_check",
    command:
      "sh -lc 'if systemctl list-unit-files nginx.service --no-legend >/dev/null 2>&1; then printf \"service=nginx\\nstatus=%s\\n\" \"$(systemctl is-active nginx 2>/dev/null || true)\"; else printf \"service=nginx\\nstatus=missing\\n\"; fi'",
  },
  {
    id: "check.service.sql",
    category: "status_check",
    command:
      "sh -lc 'for svc in mysql mariadb mysqld; do if systemctl list-unit-files \"$svc.service\" --no-legend >/dev/null 2>&1; then printf \"service=%s\\nstatus=%s\\n\" \"$svc\" \"$(systemctl is-active \"$svc\" 2>/dev/null || true)\"; exit 0; fi; done; printf \"service=sql\\nstatus=missing\\n\"'",
  },
  {
    id: "check.service.phpfpm",
    category: "status_check",
    command:
      "sh -lc 'svc=$(systemctl list-unit-files \"php*-fpm.service\" --no-legend 2>/dev/null | awk \"NR==1 {print \\$1}\" | sed \"s/\\.service$//\"); if [ -n \"$svc\" ]; then printf \"service=%s\\nstatus=%s\\n\" \"$svc\" \"$(systemctl is-active \"$svc\" 2>/dev/null || true)\"; else printf \"service=php-fpm\\nstatus=missing\\n\"; fi'",
  },
  {
    id: "fix.nginx.restart",
    category: "service_restart",
    command: "systemctl restart nginx && systemctl is-active nginx",
  },
  {
    id: "fix.sql.restart",
    category: "service_restart",
    command:
      "sh -lc 'for svc in mysql mariadb mysqld; do if systemctl list-unit-files \"$svc.service\" --no-legend >/dev/null 2>&1; then systemctl restart \"$svc\" && systemctl is-active \"$svc\"; exit $?; fi; done; echo \"No SQL service found\"; exit 1'",
  },
  {
    id: "fix.phpfpm.restart",
    category: "service_restart",
    command:
      "sh -lc 'svc=$(systemctl list-unit-files \"php*-fpm.service\" --no-legend 2>/dev/null | awk \"NR==1 {print \\$1}\" | sed \"s/\\.service$//\"); if [ -n \"$svc\" ]; then systemctl restart \"$svc\" && systemctl is-active \"$svc\"; else echo \"No PHP-FPM service found\"; exit 1; fi'",
  },
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
