import {
  calendarDateInTimeZone,
  calendarDaysRemaining,
  calendarMonthBeforeDate,
  isUnknownExpiry,
} from "@/lib/expiry/calendar-days";

export type ReminderAssetType = "domain" | "hosting" | "ssl_certificate" | "other";

export const DEFAULT_REMINDER_INTERVALS: Record<ReminderAssetType, number[]> = {
  domain: [30, 14, 7, 3, 1],
  hosting: [30, 14, 7, 3, 1],
  ssl_certificate: [14, 7, 3, 1],
  other: [30, 14, 7, 3, 1],
};

export const DEFAULT_EXPIRED_FOLLOWUPS = [0, 3, 7, 14];

export type ReminderIntervals = {
  domain: number[];
  hosting: number[];
  ssl_certificate: number[];
  expired_followup_days: number[];
};

export function parseReminderIntervals(value: unknown): ReminderIntervals {
  const fallback: ReminderIntervals = {
    domain: DEFAULT_REMINDER_INTERVALS.domain,
    hosting: DEFAULT_REMINDER_INTERVALS.hosting,
    ssl_certificate: DEFAULT_REMINDER_INTERVALS.ssl_certificate,
    expired_followup_days: DEFAULT_EXPIRED_FOLLOWUPS,
  };
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const asInts = (input: unknown, fallbackValue: number[]) =>
    Array.isArray(input) && input.every((item) => Number.isInteger(item) && (item as number) >= 0)
      ? ([...new Set(input as number[])].sort((a, b) => b - a) as number[])
      : fallbackValue;
  return {
    domain: asInts(record.domain, fallback.domain),
    hosting: asInts(record.hosting, fallback.hosting),
    ssl_certificate: asInts(record.ssl_certificate, fallback.ssl_certificate),
    expired_followup_days: asInts(record.expired_followup_days, fallback.expired_followup_days),
  };
}

export type DueReminder = {
  kind: "upcoming" | "expired";
  intervalDays: number;
  daysRemaining: number;
  calendarMonthBefore?: boolean;
};

/**
 * Returns the matching reminder bucket for today, or null if none applies.
 * Unknown expiry dates never generate reminders.
 */
export function dueReminderForAsset(options: {
  assetType: ReminderAssetType;
  expiryDate: string | null;
  now: Date;
  timeZone: string;
  intervals: ReminderIntervals;
}): DueReminder | null {
  if (isUnknownExpiry(options.expiryDate)) return null;
  const daysRemaining = calendarDaysRemaining(
    options.expiryDate as string,
    options.now,
    options.timeZone,
  );
  if (daysRemaining < 0) {
    const daysExpired = Math.max(0, Math.abs(daysRemaining) - 1);
    if (options.intervals.expired_followup_days.includes(daysExpired)) {
      return { kind: "expired", intervalDays: daysExpired, daysRemaining };
    }
    return null;
  }
  if (
    calendarDateInTimeZone(options.now, options.timeZone) ===
    calendarMonthBeforeDate(options.expiryDate as string)
  ) {
    return { kind: "upcoming", intervalDays: daysRemaining, daysRemaining, calendarMonthBefore: true };
  }
  const upcoming =
    options.assetType === "ssl_certificate"
      ? options.intervals.ssl_certificate
      : options.assetType === "hosting"
        ? options.intervals.hosting
        : options.intervals.domain;
  if (upcoming.includes(daysRemaining)) {
    return { kind: "upcoming", intervalDays: daysRemaining, daysRemaining };
  }
  return null;
}

export function reminderDeduplicationKey(input: {
  assetId: string;
  expiryDate: string;
  kind: "upcoming" | "expired";
  intervalDays: number;
  channel: string;
}): string {
  return [
    "expiry",
    input.assetId,
    input.expiryDate,
    input.kind,
    String(input.intervalDays),
    input.channel,
  ].join(":");
}
