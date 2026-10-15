import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, BellRing, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { ConfirmSubmit } from "@/app/_components/confirm-submit";
import { queueChannelTest, unlinkTelegramChat, updateNotificationSettings } from "@/app/notifications/actions";
import { TelegramLinkForm } from "@/app/notifications/telegram-link-form";
import { can } from "@/lib/auth/roles";
import { parseReminderIntervals } from "@/lib/expiry/reminders";
import { getRequestAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notification settings" };

export default function SettingsPage(props: { searchParams: Promise<{ error?: string; success?: string }> }) {
  return <Suspense fallback={<SettingsLoading />}><SettingsContent searchParams={props.searchParams} /></Suspense>;
}

async function SettingsContent({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const context = await getRequestAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const { error, success } = await searchParams;
  if (!can(context.role, "manage_notifications")) {
    return <main className="min-h-screen bg-[#f5f7fa] px-5 py-8"><div className="mx-auto max-w-4xl"><Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500"><ArrowLeft size={14} /> Overview</Link><section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><ShieldCheck size={20} className="text-slate-400" /><h1 className="mt-3 text-lg font-bold text-slate-900">Notification settings</h1><p className="mt-2 text-sm text-slate-500">Only workspace administrators can view or change notification recipients and delivery settings.</p></section></div></main>;
  }

  const supabase = await createClient();
  const { data: settings, error: queryError } = await supabase
    .from("notification_settings")
    .select("email_enabled, telegram_enabled, email_recipients, telegram_chat_ids, reminder_intervals")
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (queryError || !settings) {
    console.error("Notification settings query failed", { code: queryError?.code ?? "not_found" });
    throw new Error("Notification settings could not be loaded.");
  }
  const intervals = parseReminderIntervals(settings.reminder_intervals);
  const resendConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);

  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-5xl">
    <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Overview</Link>
    <div className="mt-6"><h1 className="text-xl font-bold tracking-tight text-slate-950">Notification settings</h1><p className="mt-1 text-sm text-slate-500">Configure private delivery channels and expiry reminder schedules.</p></div>
    {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">{settingsError(error)}</p>}
    {success && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">{settingsSuccess(success)}</p>}

    <form action={updateNotificationSettings} className="mt-6 space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center gap-2"><Mail size={17} className="text-blue-600" /><h2 className="text-sm font-bold text-slate-900">Email notifications</h2></div>
        <div className="mt-4 flex items-start justify-between gap-4 rounded-lg bg-slate-50 p-3.5"><div><p className="text-xs font-semibold text-slate-800">Resend provider configuration</p><p className="mt-1 text-[11px] text-slate-500">Server-side credentials only; provider acceptance is recorded separately from confirmed delivery.</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${resendConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{resendConfigured ? "Configured" : "Not configured"}</span></div>
        <label className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" name="emailEnabled" defaultChecked={settings.email_enabled} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /> Enable email notifications</label>
        <label htmlFor="emailRecipients" className="mb-1.5 mt-4 block text-[11px] font-semibold text-slate-700">Verified team email recipients</label>
        <textarea id="emailRecipients" name="emailRecipients" rows={3} defaultValue={settings.email_recipients.join("\n")} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500" placeholder="ops@example.com" />
        <p className="mt-1 text-[10px] text-slate-400">One email per line. Verify each recipient address with your organization before enabling delivery.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center gap-2"><MessageCircle size={17} className="text-sky-600" /><h2 className="text-sm font-bold text-slate-900">Telegram notifications</h2></div>
        <div className="mt-4 flex items-start justify-between gap-4 rounded-lg bg-slate-50 p-3.5"><div><p className="text-xs font-semibold text-slate-800">Bot configuration</p><p className="mt-1 text-[11px] text-slate-500">Bot token and webhook secret are never stored in organization settings.</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${telegramConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{telegramConfigured ? "Configured" : "Not configured"}</span></div>
        <label className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" name="telegramEnabled" defaultChecked={settings.telegram_enabled} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /> Enable Telegram notifications</label>
        <div className="mt-4"><p className="mb-2 text-[11px] font-semibold text-slate-700">Linked private chats and approved groups</p>
          {settings.telegram_chat_ids.length ? <div className="space-y-2">{settings.telegram_chat_ids.map((chatId: string) => <div key={chatId} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"><code className="text-xs text-slate-600">{chatId}</code></div>)}</div> : <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">No Telegram chats are linked yet.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center gap-2"><BellRing size={17} className="text-amber-600" /><h2 className="text-sm font-bold text-slate-900">Reminder intervals</h2></div>
        <p className="mt-1 text-[11px] text-slate-500">JSON arrays of calendar days before expiry; expired follow-ups are days past expiry after the first overdue day. Use nonnegative integers up to 365.</p>
        <label htmlFor="reminderIntervals" className="mb-1.5 mt-4 block text-[11px] font-semibold text-slate-700">Schedule configuration</label>
        <textarea id="reminderIntervals" name="reminderIntervals" rows={7} spellCheck={false} defaultValue={JSON.stringify(intervals, null, 2)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] leading-5 text-slate-700 outline-none focus:border-blue-500" />
      </section>
      <button type="submit" className="h-10 rounded-lg bg-blue-600 px-5 text-xs font-semibold text-white hover:bg-blue-700">Save notification settings</button>
    </form>
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      <h2 className="text-sm font-bold text-slate-900">Telegram chat authorization</h2>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">A workspace administrator generates a one-use code; the recipient starts the configured bot with that code to verify the chat.</p>
      {settings.telegram_chat_ids.length ? <div className="mt-4 space-y-2">{settings.telegram_chat_ids.map((chatId: string) => <div key={chatId} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"><code className="text-xs text-slate-600">{chatId}</code><form action={unlinkTelegramChat}><input type="hidden" name="chatId" value={chatId} /><ConfirmSubmit type="submit" confirmation="Unlink this Telegram chat from organization notifications?" className="text-[10px] font-semibold text-red-600 hover:underline">Unlink</ConfirmSubmit></form></div>)}</div> : <p className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">No Telegram chats are linked yet.</p>}
      <div className="mt-4"><TelegramLinkForm /></div>
      <div className="mt-4 flex flex-wrap gap-2">
        <form action={queueChannelTest}><input type="hidden" name="channel" value="email" /><button type="submit" disabled={!settings.email_enabled || !settings.email_recipients.length} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Queue email test</button></form>
        <form action={queueChannelTest}><input type="hidden" name="channel" value="telegram" /><button type="submit" disabled={!settings.telegram_enabled || !settings.telegram_chat_ids.length} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Queue Telegram test</button></form>
      </div>
    </section>
  </div></main>;
}

function settingsError(code: string) {
  if (code === "forbidden") return "Your role cannot change notification settings.";
  if (code === "invalid") return "Reminder settings or email recipients are invalid.";
  if (code === "email") return "Add at least one valid email recipient or disable email notifications.";
  if (code === "telegram") return "Link an authorized Telegram chat before enabling Telegram or confirm the chat is still linked.";
  if (code === "channel") return "The selected notification channel is disabled or has no configured recipients.";
  if (code === "test") return "The test notification could not be queued.";
  if (code === "audit") return "The test was queued, but its administrative audit record could not be saved.";
  return "Notification settings could not be saved.";
}

function settingsSuccess(code: string) {
  if (code === "test") return "Test message added to the durable notification queue. Check delivery history for the provider result.";
  if (code === "unlinked") return "Telegram chat unlinked.";
  return "Notification settings saved.";
}

function SettingsLoading() {
  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-8"><div className="mx-auto max-w-5xl animate-pulse"><div className="h-7 w-52 rounded bg-slate-200" /><div className="mt-7 h-96 rounded-xl border border-slate-200 bg-white" /></div></main>;
}
