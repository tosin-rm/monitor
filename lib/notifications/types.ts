export type NotificationChannelName = "email" | "telegram" | "whatsapp";

export type NotificationEventType =
  | "expiry_upcoming"
  | "expiry_passed"
  | "incident_opened"
  | "incident_recovered"
  | "ssl_invalid"
  | "worker_unhealthy"
  | "test";

export type NotificationPayload = {
  organizationId: string;
  eventType: NotificationEventType;
  severity: "info" | "warning" | "critical";
  title: string;
  text: string;
  html?: string;
  dashboardPath: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type NotificationRecipient = {
  channel: NotificationChannelName;
  reference: string;
};

export type SendResult =
  | { ok: true; providerMessageId?: string; accepted: boolean }
  | { ok: false; retryable: boolean; errorCode: string; sanitizedError: string };

export interface NotificationChannel {
  readonly channel: NotificationChannelName;
  send(recipient: NotificationRecipient, payload: NotificationPayload): Promise<SendResult>;
}

export const MAX_NOTIFICATION_ATTEMPTS = 8;

export function backoffSeconds(attempts: number): number {
  const capped = Math.min(Math.max(attempts, 1), MAX_NOTIFICATION_ATTEMPTS);
  return Math.min(60 * 60, 30 * 2 ** (capped - 1));
}
