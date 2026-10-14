import { dashboardUrl } from "@/lib/urls";
import type { NotificationChannel, NotificationPayload, NotificationRecipient, SendResult } from "@/lib/notifications/types";

type TelegramApi = (method: string, body: Record<string, unknown>) => Promise<{
  ok: boolean;
  result?: { message_id?: number };
  error_code?: number;
  description?: string;
}>;

export class TelegramChannel implements NotificationChannel {
  readonly channel = "telegram" as const;

  constructor(private readonly api: TelegramApi | null) {}

  async send(recipient: NotificationRecipient, payload: NotificationPayload): Promise<SendResult> {
    if (!this.api) {
      return {
        ok: false,
        retryable: false,
        errorCode: "not_configured",
        sanitizedError: "Telegram bot token is not configured",
      };
    }
    try {
      const response = await this.api("sendMessage", {
        chat_id: recipient.reference,
        text: `${payload.title}\n\n${payload.text}\n${dashboardUrl(payload.dashboardPath)}`,
        disable_web_page_preview: true,
      });
      if (!response.ok) {
        const retryable = response.error_code === 429 || (response.error_code ?? 500) >= 500;
        return {
          ok: false,
          retryable,
          errorCode: `telegram_${response.error_code ?? "error"}`,
          sanitizedError: "Telegram rejected the message. The recipient may need to /start the bot.",
        };
      }
      return {
        ok: true,
        accepted: true,
        providerMessageId: response.result?.message_id ? String(response.result.message_id) : undefined,
      };
    } catch {
      return {
        ok: false,
        retryable: true,
        errorCode: "network_failure",
        sanitizedError: "Telegram request failed",
      };
    }
  }
}

export function createTelegramApi(token: string | undefined): TelegramApi | null {
  if (!token) return null;
  return async (method, body) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Awaited<ReturnType<TelegramApi>>;
  };
}

export function createTelegramChannelFromEnv(): TelegramChannel {
  return new TelegramChannel(createTelegramApi(process.env.TELEGRAM_BOT_TOKEN));
}
