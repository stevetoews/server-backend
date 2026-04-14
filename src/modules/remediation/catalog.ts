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
    triggerCheckTypes: ["host.uptime"],
  },
  {
    actionType: "provider.reboot",
    provider: "linode",
    title: "Reboot Provider Instance",
    triggerCheckTypes: ["host.uptime"],
  },
  {
    actionType: "wordpress.cache.flush",
    allowedCommandTemplateId: "wp.cache.flush",
    provider: "ssh",
    title: "Flush WordPress Cache",
    triggerCheckTypes: ["wordpress.installation", "host.disk.root"],
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
