export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_RANK: Record<MemberRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export const PERMISSIONS = {
  view: "member",
  confirm_renewals: "member",
  acknowledge_incidents: "member",
  manage_clients: "admin",
  manage_websites: "admin",
  manage_assets: "admin",
  manage_monitoring: "admin",
  manage_notifications: "admin",
  retry_notifications: "admin",
  manage_members: "admin",
  manage_org_settings: "admin",
  view_audit: "admin",
  assign_owner: "owner",
  bootstrap: "owner",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasMinRole(role: MemberRole, minimum: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function can(role: MemberRole, permission: Permission): boolean {
  return hasMinRole(role, PERMISSIONS[permission]);
}

export function parseRole(value: string): MemberRole | null {
  return MEMBER_ROLES.includes(value as MemberRole) ? (value as MemberRole) : null;
}
