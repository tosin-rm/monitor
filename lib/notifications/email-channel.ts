import { Resend } from "resend";
import { dashboardUrl } from "@/lib/urls";
import type { NotificationChannel, NotificationPayload, NotificationRecipient, SendResult } from "@/lib/notifications/types";

export class EmailChannel implements NotificationChannel {
  readonly channel = "email" as const;

  constructor(
    private readonly resend: Pick<Resend, "emails"> | null,
    private readonly from: string | undefined,
  ) {}

  async send(recipient: NotificationRecipient, payload: NotificationPayload): Promise<SendResult> {
    if (!this.resend || !this.from) {
      return {
        ok: false,
        retryable: false,
        errorCode: "not_configured",
        sanitizedError: "Resend is not configured",
      };
    }
    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to: recipient.reference,
        subject: payload.title,
        text: `${payload.text}\n\nOpen: ${dashboardUrl(payload.dashboardPath)}`,
        html:
          payload.html ??
          `<p>${escapeHtml(payload.text)}</p><p><a href="${dashboardUrl(payload.dashboardPath)}">Open in dashboard</a></p>`,
      });
      if (result.error) {
        return {
          ok: false,
          retryable: result.error.name !== "validation_error",
          errorCode: result.error.name ?? "resend_error",
          sanitizedError: "Email provider rejected the message",
        };
      }
      return { ok: true, accepted: true, providerMessageId: result.data?.id };
    } catch {
      return {
        ok: false,
        retryable: true,
        errorCode: "network_failure",
        sanitizedError: "Email provider request failed",
      };
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createEmailChannelFromEnv(): EmailChannel {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  return new EmailChannel(key ? new Resend(key) : null, from);
}
