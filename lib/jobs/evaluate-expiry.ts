import {
  dueReminderForAsset,
  parseReminderIntervals,
  reminderDeduplicationKey,
  type ReminderAssetType,
} from "@/lib/expiry/reminders";
import type { NotificationChannelName, NotificationPayload } from "@/lib/notifications/types";

export type ExpiryAsset = {
  id: string;
  organization_id: string;
  website_id: string;
  asset_type: ReminderAssetType;
  service_name: string | null;
  hostname: string | null;
  expiry_date: string | null;
  renewal_status: string;
  active: boolean;
};

export type OrgNotificationSettings = {
  organization_id: string;
  email_enabled: boolean;
  telegram_enabled: boolean;
  email_recipients: string[];
  telegram_chat_ids: string[];
  reminder_intervals: unknown;
};

export type QueuedNotification = {
  organization_id: string;
  asset_id: string;
  event_type: "expiry_upcoming" | "expiry_passed";
  channel: NotificationChannelName;
  recipient_reference: string;
  deduplication_key: string;
  payload: NotificationPayload;
};

export function buildExpiryNotifications(options: {
  assets: ExpiryAsset[];
  settingsByOrg: Map<string, OrgNotificationSettings>;
  websitesById: Map<string, { name: string }>;
  now: Date;
  timeZoneByOrg: Map<string, string>;
}): QueuedNotification[] {
  const queued: QueuedNotification[] = [];
  for (const asset of options.assets) {
    if (!asset.active || asset.renewal_status === "cancelled") continue;
    const settings = options.settingsByOrg.get(asset.organization_id);
    if (!settings) continue;
    const reminder = dueReminderForAsset({
      assetType: asset.asset_type,
      expiryDate: asset.expiry_date,
      now: options.now,
      timeZone: options.timeZoneByOrg.get(asset.organization_id) ?? "Europe/London",
      intervals: parseReminderIntervals(settings.reminder_intervals),
    });
    if (!reminder || !asset.expiry_date) continue;
    const websiteName = options.websitesById.get(asset.website_id)?.name ?? "Website";
    const eventType = reminder.kind === "expired" ? "expiry_passed" : "expiry_upcoming";
    const title =
      reminder.kind === "expired"
        ? `${websiteName}: ${asset.asset_type} expired`
        : `${websiteName}: ${asset.asset_type} expires in ${reminder.daysRemaining} day(s)`;
    const text = [
      `Service: ${asset.service_name ?? asset.hostname ?? asset.asset_type}`,
      `Expiry date: ${asset.expiry_date}`,
      reminder.kind === "expired"
        ? `This service is ${Math.abs(reminder.daysRemaining)} day(s) past expiry.`
        : `Renew before ${asset.expiry_date}.`,
    ].join("\n");
    const payload: NotificationPayload = {
      organizationId: asset.organization_id,
      eventType,
      severity: reminder.kind === "expired" || reminder.daysRemaining <= 3 ? "critical" : "warning",
      title,
      text,
      dashboardPath: `/inventory?asset=${asset.id}`,
    };
    const recipients: Array<{ channel: NotificationChannelName; reference: string }> = [];
    if (settings.email_enabled) {
      for (const email of settings.email_recipients) {
        recipients.push({ channel: "email", reference: email });
      }
    }
    if (settings.telegram_enabled) {
      for (const chat of settings.telegram_chat_ids) {
        recipients.push({ channel: "telegram", reference: chat });
      }
    }
    for (const recipient of recipients) {
      queued.push({
        organization_id: asset.organization_id,
        asset_id: asset.id,
        event_type: eventType,
        channel: recipient.channel,
        recipient_reference: recipient.reference,
        deduplication_key: reminderDeduplicationKey({
          assetId: asset.id,
          expiryDate: asset.expiry_date,
          kind: reminder.kind,
          intervalDays: reminder.intervalDays,
          channel: `${recipient.channel}:${recipient.reference}`,
        }),
        payload,
      });
    }
  }
  return queued;
}
