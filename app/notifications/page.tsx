import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Bell, CheckCircle2, Mail, MessageCircle, RefreshCw } from "lucide-react";
import { retryNotification } from "@/app/notifications/actions";
import { can } from "@/lib/auth/roles";
import { getRequestAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage(props: { searchParams: Promise<{ error?: string; success?: string }> }) {
  return <Suspense fallback={<NotificationsLoading />}><NotificationsContent searchParams={props.searchParams} /></Suspense>;
}

async function NotificationsContent({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const context = await getRequestAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: notifications, error: queryError } = await supabase
    .from("notifications")
    .select("id, event_type, channel, recipient_reference, status, retryable, attempts, max_attempts, scheduled_at, sent_at, delivered_at, last_attempt_at, next_attempt_at, provider_message_id, sanitized_error, created_at")
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (queryError) {
    console.error("Notification history query failed", { code: queryError.code });
    throw new Error("Notification history could not be loaded.");
  }
  const rows = notifications ?? [];
  const failures = rows.filter((row) => row.status === "failed").length;

  return <main className="min-h-screen bg-white px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-6xl">
    <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Overview</Link>
    <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-xl font-bold tracking-tight text-slate-950">Notifications</h1><p className="mt-1 text-sm text-slate-500">Durable delivery history, provider acceptance, and retryable failures.</p></div><Link href="/settings" className="h-9 rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-600 hover:bg-slate-50">Notification settings</Link></div>
    {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error === "forbidden" ? "Your role cannot retry notifications." : error === "retry" ? "The notification is not eligible for retry, or the retry request failed." : "Check the notification and try again."}</p>}
    {success && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">Eligible notification queued for another delivery attempt.</p>}
    <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Metric icon={<Bell size={16} />} label="Recent notifications" value={rows.length} detail="Most recent 100 records" />
      <Metric icon={<CheckCircle2 size={16} />} label="Provider accepted" value={rows.filter((row) => row.status === "accepted" || row.status === "delivered").length} detail="Acceptance is not delivery confirmation" />
      <Metric icon={<RefreshCw size={16} />} label="Failures" value={failures} detail="Review retry eligibility below" />
    </section>
    <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Delivery log</h2><p className="mt-0.5 text-[11px] text-slate-400">Rows remain available after a provider error for review and controlled retry.</p></div><Bell size={16} className="text-slate-400" /></div>
      {rows.length ? <div className="divide-y divide-slate-100">{rows.map((notification) => {
        const eligible = notification.status === "failed" && notification.retryable && notification.attempts < notification.max_attempts;
        const ChannelIcon = notification.channel === "email" ? Mail : MessageCircle;
        return <article key={notification.id} className="flex flex-col gap-3 px-5 py-4 xl:flex-row xl:items-center">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${notification.status === "accepted" || notification.status === "delivered" ? "bg-emerald-50 text-emerald-700" : notification.status === "failed" ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-500"}`}><ChannelIcon size={16} /></span>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-800">{notification.event_type.replaceAll("_", " ")}</p><p className="mt-1 truncate text-[10px] text-slate-500">{notification.recipient_reference}</p><p className="mt-1 text-[10px] text-slate-400">{notification.channel} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone }).format(new Date(notification.created_at))}</p></div>
          <div className="min-w-0 xl:max-w-[300px]"><p className="text-[10px] text-slate-500">Attempts: {notification.attempts}/{notification.max_attempts} · <span className="font-semibold capitalize">{notification.status}</span></p>{notification.delivered_at && <p className="mt-1 text-[10px] text-emerald-700">Delivered: {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone }).format(new Date(notification.delivered_at))}</p>}{notification.provider_message_id && <p className="mt-1 truncate text-[10px] text-slate-400">Provider reference: {notification.provider_message_id}</p>}{notification.sanitized_error && <p className="mt-1 text-[10px] leading-4 text-red-700">{notification.sanitized_error}</p>}</div>
          {eligible && can(context.role, "retry_notifications") && <form action={retryNotification}><input type="hidden" name="notificationId" value={notification.id} /><button type="submit" className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw size={12} /> Retry</button></form>}
        </article>;
      })}</div> : <div className="px-6 py-14 text-center"><Bell size={22} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No notification history yet</p><p className="mt-1 text-xs text-slate-400">Expiry and incident notifications will be recorded here.</p></div>}
    </section>
  </div></main>;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: number; detail: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-red-600">{icon}<p className="text-xs font-semibold text-slate-500">{label}</p></div><p className="mt-3 text-2xl font-bold text-slate-950">{value}</p><p className="mt-1 text-[10px] text-slate-400">{detail}</p></div>;
}

function NotificationsLoading() {
  return <main className="min-h-screen bg-white px-5 py-8"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-7 w-48 rounded bg-slate-200" /><div className="mt-7 h-[600px] rounded-xl border border-slate-200 bg-white" /></div></main>;
}
