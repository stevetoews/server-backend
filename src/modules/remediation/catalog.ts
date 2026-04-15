export interface RemediationActionDefinition {
  actionType: string;
  allowedCommandTemplateId?: string;
  provider: "ssh" | "linode";
  title: string;
  triggerCheckTypes: string[];
}

export const remediationCatalog: readonly RemediationActionDefinition[] = [
  {
    actionType: "restart.nginx",
    allowedCommandTemplateId: "fix.nginx.restart",
    provider: "ssh",
    title: "Restart Nginx",
    triggerCheckTypes: ["service.nginx"],
  },
  {
    actionType: "restart.sql",
    allowedCommandTemplateId: "fix.sql.restart",
    provider: "ssh",
    title: "Restart SQL Service",
    triggerCheckTypes: ["service.sql"],
  },
  {
    actionType: "restart.phpfpm",
    allowedCommandTemplateId: "fix.phpfpm.restart",
    provider: "ssh",
    title: "Restart PHP-FPM",
    triggerCheckTypes: ["service.phpfpm"],
  },
  {
    actionType: "provider.reboot",
    provider: "linode",
    title: "Reboot Provider Instance",
    triggerCheckTypes: ["host.uptime"],
  },
];

export function getRemediationActionsForCheckType(checkType?: string) {
  if (!checkType) {
    return [];
  }

  return remediationCatalog.filter((action) => action.triggerCheckTypes.includes(checkType));
}

export function getRemediationActionByType(actionType: string) {
  return remediationCatalog.find((action) => action.actionType === actionType);
}
