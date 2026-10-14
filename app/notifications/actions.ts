"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/auth/roles";
import { getAuthContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { NotificationPayload, NotificationChannelName } from "@/lib/notifications/types";

const reminderSchema = z.object({
  domain: z.array(z.number().int().min(0).max(365)).max(50),
  hosting: z.array(z.number().int().min(0).max(365)).max(50),
  ssl_certificate: z.array(z.number().int().min(0).max(365)).max(50),
  expired_followup_days: z.array(z.number().int().min(0).max(365)).max(50),
}).superRefine((value, context) => {
  for (const [key, intervals] of Object.entries(value)) {
    if (new Set(intervals).size !== intervals.length) {
      context.addIssue({
        code: "custom",
        message: `${key} reminder days must be unique`,
        path: [key],
      });
    }
  }
});

const emailsSchema = z.array(z.string().email().max(254)).max(30);

export async function updateNotificationSettings(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_notifications")) redirect("/settings?error=forbidden");

  const emails = String(formData.get("emailRecipients") ?? "")
    .split(/[\n,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const parsedEmails = emailsSchema.safeParse([...new Set(emails)]);
  let parsedIntervals;
  try {
    parsedIntervals = reminderSchema.safeParse(JSON.parse(String(formData.get("reminderIntervals") ?? "")));
  } catch {
    redirect("/settings?error=invalid");
  }
  if (!parsedEmails.success || !parsedIntervals.success) redirect("/settings?error=invalid");

  const emailEnabled = String(formData.get("emailEnabled") ?? "") === "on";
  const telegramEnabled = String(formData.get("telegramEnabled") ?? "") === "on";
  if (emailEnabled && parsedEmails.data.length === 0) redirect("/settings?error=email");

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("notification_settings")
    .select("telegram_chat_ids")
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (readError || !existing) {
    console.error("Notification settings lookup failed", { code: readError?.code ?? "not_found" });
    redirect("/settings?error=save");
  }
  if (telegramEnabled && existing.telegram_chat_ids.length === 0) {
    redirect("/settings?error=telegram");
  }

  const { error } = await supabase.from("notification_settings").update({
    email_enabled: emailEnabled,
    telegram_enabled: telegramEnabled,
    email_recipients: parsedEmails.data,
    reminder_intervals: parsedIntervals.data,
  }).eq("organization_id", context.organizationId);
  if (error) {
    console.error("Notification settings update failed", { code: error.code });
    redirect("/settings?error=save");
  }
  redirect("/settings?success=saved");
}

export async function queueChannelTest(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_notifications")) redirect("/settings?error=forbidden");

  const channel = String(formData.get("channel") ?? "") as NotificationChannelName;
  if (channel !== "email" && channel !== "telegram") redirect("/settings?error=invalid");
  const supabase = await createClient();
  const { data: settings, error: settingsError } = await supabase
    .from("notification_settings")
    .select("email_enabled, email_recipients, telegram_enabled, telegram_chat_ids")
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (settingsError || !settings) {
    console.error("Test notification settings lookup failed", { code: settingsError?.code ?? "not_found" });
    redirect("/settings?error=save");
  }

  const enabled = channel === "email" ? settings.email_enabled : settings.telegram_enabled;
  const recipients: string[] = channel === "email" ? settings.email_recipients : settings.telegram_chat_ids;
  if (!enabled || recipients.length === 0) redirect("/settings?error=channel");

  const payload: NotificationPayload = {
    organizationId: context.organizationId,
    eventType: "test",
    severity: "info",
    title: "Monitor test notification",
    text: `This is a test notification requested by ${context.email}.`,
    dashboardPath: "/notifications",
  };
  const admin = createAdminClient();
  const nonce = randomUUID();
  const { data, error } = await admin.from("notifications").insert(
    recipients.map((reference) => ({
      organization_id: context.organizationId,
      event_type: "test",
      channel,
      recipient_reference: reference,
      deduplication_key: `test:${context.organizationId}:${channel}:${nonce}:${reference}`,
      payload,
      status: "queued",
      retryable: true,
    })),
  ).select("id");
  if (error) {
    console.error("Test notification enqueue failed", { code: error.code });
    redirect("/settings?error=test");
  }
  const { error: auditError } = await admin.from("audit_logs").insert({
    organization_id: context.organizationId,
    actor_user_id: context.userId,
    action: "notification.test_queued",
    entity_type: "notification",
    metadata: { channel, recipient_count: data?.length ?? recipients.length },
  });
  if (auditError) {
    console.error("Test notification audit failed", { code: auditError.code });
    redirect("/settings?error=audit");
  }
  redirect("/settings?success=test");
}

export async function retryNotification(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "retry_notifications")) redirect("/notifications?error=forbidden");
  const notificationId = z.string().uuid().safeParse(String(formData.get("notificationId") ?? ""));
  if (!notificationId.success) redirect("/notifications?error=invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("retry_notification", {
    p_notification_id: notificationId.data,
    p_organization_id: context.organizationId,
  });
  if (error) {
    console.error("Notification retry request failed", { code: error.code });
    redirect("/notifications?error=retry");
  }
  redirect("/notifications?success=retry");
}

export async function unlinkTelegramChat(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_notifications")) redirect("/settings?error=forbidden");
  const chatId = String(formData.get("chatId") ?? "");
  if (!/^-?[0-9]{1,32}$/.test(chatId)) redirect("/settings?error=invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_telegram_chat", {
    p_organization_id: context.organizationId,
    p_chat_id: chatId,
  });
  if (error) {
    console.error("Telegram chat unlink failed", { code: error.code });
    redirect("/settings?error=telegram");
  }
  redirect("/settings?success=unlinked");
}

export async function createTelegramLinkChallenge(
  _previous: { code: string | null; error: string | null },
  _formData: FormData,
): Promise<{ code: string | null; error: string | null }> {
  void _previous;
  void _formData;
  const context = await getAuthContext();
  if (!context) return { code: null, error: "Sign in before linking a chat." };
  if (!context.organizationId) return { code: null, error: "This account is not attached to a workspace." };
  if (!can(context.role, "manage_notifications")) {
    return { code: null, error: "Your role cannot manage notification settings." };
  }

  const code = randomBytes(24).toString("base64url");
  const codeHash = createHash("sha256").update(code).digest("hex");
  const admin = createAdminClient();
  const { error } = await admin.from("telegram_link_challenges").insert({
    organization_id: context.organizationId,
    code_hash: codeHash,
    created_by: context.userId,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) {
    console.error("Telegram link challenge creation failed", { code: error.code });
    return { code: null, error: "A Telegram linking code could not be created." };
  }
  return { code, error: null };
}
