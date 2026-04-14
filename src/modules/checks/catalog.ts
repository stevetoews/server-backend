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
    commandTemplateId: "check.disk.usage",
  },
  {
    id: "wordpress.installation",
    target: "wordpress",
    intervalMinutes: 15,
    description: "Confirm WordPress is installed and WP-CLI responds",
    commandTemplateId: "wp.core.isInstalled",
  },
];
