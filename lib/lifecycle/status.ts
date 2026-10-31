export const LIFECYCLE_STATUSES = ["active", "on_hold", "transferred", "archived"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export type LifecycleFilter = LifecycleStatus | "all";

export function lifecycleLabel(status: LifecycleStatus): string {
  switch (status) {
    case "active": return "Active";
    case "on_hold": return "On hold";
    case "transferred": return "Transferred";
    case "archived": return "Archived";
  }
}

export function effectiveWebsiteStatus(websiteStatus: LifecycleStatus, clientStatus: LifecycleStatus): LifecycleStatus {
  return websiteStatus === "active" ? clientStatus : websiteStatus;
}

export function parseLifecycleFilter(value: string | undefined): LifecycleFilter {
  if (value === "all" || LIFECYCLE_STATUSES.includes(value as LifecycleStatus)) {
    return value as LifecycleFilter;
  }
  return "active";
}
