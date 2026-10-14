import type { NotificationChannel, SendResult } from "@/lib/notifications/types";

/**
 * Official WhatsApp Business Platform adapter is intentionally unimplemented.
 * Enable only after Cloud API credentials, approved templates, and pricing
 * are documented for the organization.
 */
export class WhatsAppChannel implements NotificationChannel {
  readonly channel = "whatsapp" as const;

  async send(): Promise<SendResult> {
    return {
      ok: false,
      retryable: false,
      errorCode: "not_implemented",
      sanitizedError: "WhatsApp Business Platform is not enabled",
    };
  }
}
