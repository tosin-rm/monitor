import { describe, expect, it } from "vitest";
import { calendarDateInTimeZone, calendarDaysRemaining, isUnknownExpiry } from "@/lib/expiry/calendar-days";

describe("calendar expiry dates", () => {
  it("calculates remaining days using the organization calendar date", () => {
    expect(calendarDaysRemaining("2025-01-02", new Date("2025-01-02T01:00:00.000Z"), "America/Los_Angeles")).toBe(1);
    expect(calendarDaysRemaining("2025-01-02", new Date("2025-01-02T01:00:00.000Z"), "Europe/London")).toBe(0);
  });

  it("handles timezone date boundaries around a daylight-saving transition", () => {
    const instant = new Date("2025-03-30T00:30:00.000Z");
    expect(calendarDateInTimeZone(instant, "Europe/London")).toBe("2025-03-30");
    expect(calendarDaysRemaining("2025-03-31", instant, "Europe/London")).toBe(1);
  });

  it("returns negative values for expired services and recognizes missing dates", () => {
    expect(calendarDaysRemaining("2024-12-30", new Date("2025-01-01T12:00:00.000Z"), "UTC")).toBe(-2);
    expect(isUnknownExpiry(null)).toBe(true);
    expect(isUnknownExpiry("")).toBe(true);
    expect(isUnknownExpiry("2025-01-01")).toBe(false);
  });
});
