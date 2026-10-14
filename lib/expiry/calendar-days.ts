/**
 * Calendar-day remaining calculations in a named IANA timezone.
 * Expiry is stored as a DATE (no time). Comparisons use the calendar date
 * in the organization timezone to avoid off-by-one errors around midnight UTC.
 */

export function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(instant);
}

function parseIsoDate(isoDate: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Invalid ISO date: ${isoDate}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function utcMidnightFromParts(parts: { year: number; month: number; day: number }): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

export function calendarDaysRemaining(
  expiryDate: string,
  now: Date,
  timeZone: string,
): number {
  const today = parseIsoDate(calendarDateInTimeZone(now, timeZone));
  const expiry = parseIsoDate(expiryDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((utcMidnightFromParts(expiry) - utcMidnightFromParts(today)) / msPerDay);
}

export function isUnknownExpiry(expiryDate: string | null | undefined): boolean {
  return expiryDate == null || expiryDate === "";
}
