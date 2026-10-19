import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Globe2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { canUseDevPreview } from "@/lib/auth/dev-preview";

const metrics = [
  { label: "Active clients", value: "12", detail: "Client accounts", icon: Building2, color: "text-red-600", bg: "bg-red-50" },
  { label: "Active websites", value: "18", detail: "Across your portfolio", icon: Globe2, color: "text-emerald-600", bg: "bg-emerald-50" },
  { label: "Expiring soon", value: "4", detail: "Within the next 30 days", icon: CalendarClock, color: "text-amber-600", bg: "bg-amber-50" },
  { label: "Expired services", value: "1", detail: "Renewal needs attention", icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
  { label: "Websites down", value: "1", detail: "Confirmed open outages", icon: Activity, color: "text-red-600", bg: "bg-red-50" },
  { label: "Open incidents", value: "2", detail: "Awaiting resolution", icon: CircleAlert, color: "text-violet-600", bg: "bg-violet-50" },
  { label: "SSL attention", value: "2", detail: "Due within 30 days", icon: LockKeyhole, color: "text-amber-600", bg: "bg-amber-50" },
  { label: "Notification failures", value: "0", detail: "In the last 7 days", icon: Bell, color: "text-red-600", bg: "bg-red-50" },
];

const renewals = [
  { client: "Northstar Studio", website: "northstar.example", service: "Domain", date: "22 Oct 2026", days: "8 days", tone: "text-red-700 bg-red-50" },
  { client: "Harbor & Pine", website: "harborpine.example", service: "SSL certificate", date: "29 Oct 2026", days: "15 days", tone: "text-amber-700 bg-amber-50" },
  { client: "Mosaic Works", website: "mosaicworks.example", service: "Hosting", date: "13 Nov 2026", days: "30 days", tone: "text-slate-600 bg-slate-100" },
];

const activity = [
  { title: "Renewal confirmed", detail: "Mosaic Works · Hosting", time: "Today, 10:42", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50" },
  { title: "Incident acknowledged", detail: "Northstar Studio · Website outage", time: "Today, 09:18", icon: CircleAlert, color: "text-amber-600 bg-amber-50" },
  { title: "Website added", detail: "Harbor & Pine · Production site", time: "Yesterday, 16:05", icon: Globe2, color: "text-red-600 bg-red-50" },
];

export default function DevPreviewPage() {
  if (!canUseDevPreview(process.env.NODE_ENV, process.env.DEV_PREVIEW_ENABLED)) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-900">
        Local design preview — sample data only. This is not a signed-in session and does not access Supabase.
      </div>
      <aside className="fixed inset-y-[41px] left-0 z-10 hidden w-[248px] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-[76px] items-center gap-3 border-b border-slate-100 px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600 text-white"><Activity size={19} strokeWidth={2.6} /></span>
          <span><span className="block text-[15px] font-bold tracking-tight text-slate-950">monitor</span><span className="block text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Client operations</span></span>
        </div>
        <nav className="space-y-1 px-4 pt-7" aria-label="Preview navigation">
          {[
            ["Overview", "Current preview"],
            ["Clients", "Client list"],
            ["Websites", "Website inventory"],
            ["Infrastructure", "Expiry dates"],
            ["Incidents", "Incident timeline"],
            ["Notifications", "Delivery history"],
          ].map(([label, detail], index) => (
            <div key={label} className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-xs ${index === 0 ? "bg-red-50 font-semibold text-red-700" : "text-slate-500"}`}>
              <span>{label}</span><span className="text-[9px] opacity-60">{detail}</span>
            </div>
          ))}
        </nav>
        <div className="mt-auto border-t border-slate-100 px-5 py-4 text-[10px] leading-4 text-slate-400">
          Preview controls are non-interactive. Sign in to use real records and actions.
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="flex h-[68px] items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-8">
          <div><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Workspace</p><p className="text-sm font-bold text-slate-900">Example Web Studio</p></div>
          <div className="flex items-center gap-3"><span className="hidden text-xs text-slate-500 sm:inline">Developer preview</span><span className="rounded-full border border-slate-200 px-3 py-1.5 text-[10px] font-semibold text-slate-600">Not authenticated</span></div>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-9">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><p className="text-xs font-medium text-slate-400">Wednesday, 14 October 2026</p><h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950">Good afternoon, developer</h1><p className="mt-1 text-sm text-slate-500">A visual preview of the client operations dashboard.</p></div>
            <Link href="/login" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Go to sign in <ArrowRight size={14} /></Link>
          </div>

          <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(({ label, value, detail, icon: Icon, color, bg }) => (
              <article key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg} ${color}`}><Icon size={16} /></span></div>
                <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-[10px] text-slate-400">{detail}</p>
              </article>
            ))}
          </section>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Upcoming renewals</h2><p className="mt-0.5 text-[11px] text-slate-400">Example services requiring attention</p></div><CalendarClock size={17} className="text-slate-400" /></div>
              <div className="divide-y divide-slate-100">
                {renewals.map((renewal) => <article key={renewal.website} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{renewal.website}</p><p className="mt-1 text-[10px] text-slate-400">{renewal.client} · {renewal.service}</p></div><div className="flex items-center gap-3 sm:text-right"><div><p className="text-xs font-semibold text-slate-700">{renewal.date}</p><p className="mt-1 text-[10px] text-slate-400">Expiry date</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${renewal.tone}`}>{renewal.days}</span></div></article>)}
              </div>
              <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-[10px] text-slate-400">These are fictional preview records—not production data.</div>
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Recent activity</h2><p className="mt-0.5 text-[11px] text-slate-400">Example team actions</p></div><Activity size={17} className="text-slate-400" /></div>
              <div className="divide-y divide-slate-100">{activity.map(({ title, detail, time, icon: Icon, color }) => <article key={title} className="flex items-start gap-3 px-5 py-4"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color}`}><Icon size={15} /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-800">{title}</p><p className="mt-1 text-[10px] text-slate-500">{detail}</p></div><time className="whitespace-nowrap text-[9px] text-slate-400">{time}</time></article>)}</div>
            </section>
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50/70 p-4"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-red-700" /><p className="text-xs leading-5 text-red-900"><strong>Safe preview mode.</strong> All numbers and names on this page are hardcoded examples for layout review. No authentication is skipped for the real application, no database is queried, and no changes can be saved here.</p></div>
        </div>
      </div>
    </main>
  );
}
