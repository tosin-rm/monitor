import { describe, expect, it } from "vitest";
import { buildExpiryNotifications, type OrgNotificationSettings } from "@/lib/jobs/evaluate-expiry";

const settings: OrgNotificationSettings = {
  organization_id: "org-1",
  email_enabled: true,
  telegram_enabled: true,
  email_recipients: ["ops@example.com"],
  telegram_chat_ids: ["-100123"],
  reminder_intervals: {
    domain: [30, 14, 7, 3, 1],
    hosting: [30, 14, 7, 3, 1],
    ssl_certificate: [14, 7, 3, 1],
    expired_followup_days: [0, 3, 7, 14],
  },
};

describe("expiry evaluation queue payloads", () => {
  it("creates idempotent recipient-specific reminders for configured channels", () => {
    const input = {
      assets: [{
        id: "asset-1",
        organization_id: "org-1",
        website_id: "website-1",
        asset_type: "domain" as const,
        service_name: "Production domain",
        hostname: "example.com",
        expiry_date: "2025-01-31",
        renewal_status: "active",
        active: true,
      }],
      settingsByOrg: new Map([["org-1", settings]]),
      websitesById: new Map([["website-1", { name: "Example" }]]),
      now: new Date("2025-01-01T12:00:00.000Z"),
      timeZoneByOrg: new Map([["org-1", "UTC"]]),
    };
    const first = buildExpiryNotifications(input);
    const repeated = buildExpiryNotifications(input);
    expect(first).toHaveLength(2);
    expect(first.map((row) => row.deduplication_key)).toEqual(repeated.map((row) => row.deduplication_key));
    expect(new Set(first.map((row) => row.deduplication_key)).size).toBe(2);
    expect(first.map((row) => row.channel).sort()).toEqual(["email", "telegram"]);
  });

  it("queues the calendar-month reminder to configured email recipients", () => {
    const queued = buildExpiryNotifications({
      assets: [{
        id: "asset-month",
        organization_id: "org-1",
        website_id: "website-1",
        asset_type: "ssl_certificate",
        service_name: "Production certificate",
        hostname: "example.com",
        expiry_date: "2025-03-31",
        renewal_status: "active",
        active: true,
      }],
      settingsByOrg: new Map([["org-1", { ...settings, telegram_enabled: false }]]),
      websitesById: new Map([["website-1", { name: "Example" }]]),
      now: new Date("2025-02-28T12:00:00.000Z"),
      timeZoneByOrg: new Map([["org-1", "UTC"]]),
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]?.channel).toBe("email");
    expect(queued[0]?.recipient_reference).toBe("ops@example.com");
    expect(queued[0]?.payload.title).toContain("expires in one calendar month");
    expect(queued[0]?.payload.text).toContain("one-calendar-month expiry reminder");
  });

  it("does not create queue records for unknown expiry dates or disabled channels", () => {
    const queued = buildExpiryNotifications({
      assets: [{
        id: "asset-unknown",
        organization_id: "org-1",
        website_id: "website-1",
        asset_type: "hosting",
        service_name: null,
        hostname: null,
        expiry_date: null,
        renewal_status: "unknown",
        active: true,
      }],
      settingsByOrg: new Map([["org-1", { ...settings, email_enabled: false, telegram_enabled: false }]]),
      websitesById: new Map([["website-1", { name: "Example" }]]),
      now: new Date("2025-01-01T12:00:00.000Z"),
      timeZoneByOrg: new Map([["org-1", "UTC"]]),
    });
    expect(queued).toEqual([]);
  });
});
