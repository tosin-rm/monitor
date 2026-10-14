import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPIRED_FOLLOWUPS,
  DEFAULT_REMINDER_INTERVALS,
  dueReminderForAsset,
  parseReminderIntervals,
  reminderDeduplicationKey,
} from "@/lib/expiry/reminders";

const intervals = {
  ...DEFAULT_REMINDER_INTERVALS,
  expired_followup_days: DEFAULT_EXPIRED_FOLLOWUPS,
};

describe("expiry reminder scheduling", () => {
  it("uses the configured reminder bucket by asset type", () => {
    expect(dueReminderForAsset({
      assetType: "domain",
      expiryDate: "2025-01-31",
      now: new Date("2025-01-01T12:00:00.000Z"),
      timeZone: "UTC",
      intervals,
    })).toEqual({ kind: "upcoming", intervalDays: 30, daysRemaining: 30 });

    expect(dueReminderForAsset({
      assetType: "ssl_certificate",
      expiryDate: "2025-01-31",
      now: new Date("2025-01-17T12:00:00.000Z"),
      timeZone: "UTC",
      intervals,
    })).toEqual({ kind: "upcoming", intervalDays: 14, daysRemaining: 14 });
  });

  it("does not schedule unknown or non-bucket dates and supports controlled expired follow-ups", () => {
    expect(dueReminderForAsset({
      assetType: "domain",
      expiryDate: null,
      now: new Date("2025-01-01T12:00:00.000Z"),
      timeZone: "UTC",
      intervals,
    })).toBeNull();

    expect(dueReminderForAsset({
      assetType: "domain",
      expiryDate: "2025-01-05",
      now: new Date("2025-01-01T12:00:00.000Z"),
      timeZone: "UTC",
      intervals,
    })).toBeNull();

    expect(dueReminderForAsset({
      assetType: "hosting",
      expiryDate: "2024-12-28",
      now: new Date("2025-01-01T12:00:00.000Z"),
      timeZone: "UTC",
      intervals,
    })).toEqual({ kind: "expired", intervalDays: 3, daysRemaining: -4 });

    expect(dueReminderForAsset({
      assetType: "hosting",
      expiryDate: "2024-12-31",
      now: new Date("2025-01-01T12:00:00.000Z"),
      timeZone: "UTC",
      intervals,
    })).toEqual({ kind: "expired", intervalDays: 0, daysRemaining: -1 });
  });

  it("validates settings and changes the deduplication schedule when expiry changes", () => {
    expect(parseReminderIntervals({ domain: [14, -1] }).domain).toEqual([30, 14, 7, 3, 1]);
    const base = {
      assetId: "asset-1",
      kind: "upcoming" as const,
      intervalDays: 14,
      channel: "email:ops@example.com",
    };
    expect(reminderDeduplicationKey({ ...base, expiryDate: "2025-01-31" })).not.toBe(
      reminderDeduplicationKey({ ...base, expiryDate: "2025-02-28" }),
    );
  });
});
