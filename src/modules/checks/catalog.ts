export interface CheckDefinition {
  commandTemplateId?: string;
  description: string;
  id: string;
  intervalMinutes: number;
  target: "host" | "wordpress";
}

export const checkCatalog: readonly CheckDefinition[] = [
  {
    id: "host.uptime",
    target: "host",
    intervalMinutes: 5,
    description: "Verify the server remains reachable and reports uptime",
    commandTemplateId: "check.host.uptime",
  },
  {
    id: "host.disk.root",
    target: "host",
    intervalMinutes: 5,
    description: "Inspect root filesystem usage to catch capacity issues",
    commandTemplateId: "check.disk.root",
  },
  {
    id: "service.nginx",
    target: "host",
    intervalMinutes: 5,
    description: "Confirm the Nginx service is active",
    commandTemplateId: "check.service.nginx",
  },
  {
    id: "service.sql",
    target: "host",
    intervalMinutes: 5,
    description: "Confirm the SQL service is active",
    commandTemplateId: "check.service.sql",
  },
  {
    id: "service.phpfpm",
    target: "host",
    intervalMinutes: 5,
    description: "Confirm the PHP-FPM service is active",
    commandTemplateId: "check.service.phpfpm",
  },
];
