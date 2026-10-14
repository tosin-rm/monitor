import { createEmailChannelFromEnv } from "@/lib/notifications/email-channel";
import { createTelegramChannelFromEnv } from "@/lib/notifications/telegram-channel";
import { WhatsAppChannel } from "@/lib/notifications/whatsapp-channel";
import type { NotificationChannel, NotificationChannelName } from "@/lib/notifications/types";

export function defaultNotificationChannels(): Record<NotificationChannelName, NotificationChannel> {
  return {
    email: createEmailChannelFromEnv(),
    telegram: createTelegramChannelFromEnv(),
    whatsapp: new WhatsAppChannel(),
  };
}
