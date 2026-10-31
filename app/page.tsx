import Link from "next/link";
import { Suspense } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Globe2,
  LayoutDashboard,
  LifeBuoy,
  LockKeyhole,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { can } from "@/lib/auth/roles";
import { requireRequestAuth } from "@/lib/auth/session";
import { calendarDateInTimeZone } from "@/lib/expiry/calendar-days";
import { createClient } from "@/lib/supabase/server";

type Metric = {
  title: string;
  value: number;
  detail: string;
  icon: typeof Building2;
  tone: "brand" | "green" | "amber" | "red" | "purple";
};

function displayDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(`${value}T12:00:00Z`));
}

function daysRemaining(expiry: string, today: string): number {
  return Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  const context = await requireRequestAuth();
  const supabase = await createClient();
  const organizationId = context.organizationId;
  const today = calendarDateInTimeZone(new Date(), context.timeZone);
  const weekAgo = new Date(new Date().getTime() - 7 * 86_400_000).toISOString();
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  const soonDate = soon.toISOString().slice(0, 10);

  const [
    clientsResult,
    websitesResult,
    expiringResult,
    expiredResult,
    outagesResult,
    incidentsResult,
    sslResult,
    notificationFailuresResult,
    upcomingResult,
    activityResult,
  ] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("active", true),
    supabase.from("websites").select("id, client:clients!inner(active)", { count: "exact", head: true }).eq("organization_id", organizationId).eq("active", true).eq("client.active", true),
    supabase.from("assets").select("id, website:websites!inner(active, client:clients!inner(active))", { count: "exact", head: true }).eq("organization_id", organizationId).eq("active", true).eq("website.active", true).eq("website.client.active", true).gte("expiry_date", today).lte("expiry_date", soonDate),
    supabase.from("assets").select("id, website:websites!inner(active, client:clients!inner(active))", { count: "exact", head: true }).eq("organization_id", organizationId).eq("active", true).eq("website.active", true).eq("website.client.active", true).lt("expiry_date", today).neq("renewal_status", "cancelled"),
    supabase.from("incidents").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("incident_type", "outage").in("status", ["open", "acknowledged", "investigating"]),
    supabase.from("incidents").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ["open", "acknowledged", "investigating"]),
    supabase.from("assets").select("id, website:websites!inner(active, client:clients!inner(active))", { count: "exact", head: true }).eq("organization_id", organizationId).eq("active", true).eq("website.active", true).eq("website.client.active", true).eq("asset_type", "ssl_certificate").lte("expiry_date", soonDate).neq("renewal_status", "cancelled"),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "failed").gte("created_at", weekAgo),
    supabase.from("assets").select("id, asset_type, expiry_date, service_name, hostname, renewal_responsibility, website:websites!inner(active, name, client:clients!inner(active, name))").eq("organization_id", organizationId).eq("active", true).eq("website.active", true).eq("website.client.active", true).gte("expiry_date", today).lte("expiry_date", soonDate).order("expiry_date", { ascending: true }).limit(6),
    can(context.role, "view_audit")
      ? supabase.from("audit_logs").select("id, action, entity_type, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [], error: null, count: null, status: 200, statusText: "OK" }),
  ]);

  const results = [
    clientsResult,
    websitesResult,
    expiringResult,
    expiredResult,
    outagesResult,
    incidentsResult,
    sslResult,
    notificationFailuresResult,
    upcomingResult,
    activityResult,
  ];
  if (results.some((result) => result.error)) {
    console.error("Dashboard query failed", results.filter((result) => result.error).map((result) => result.error?.code));
    throw new Error("Dashboard information could not be loaded. Please try again.");
  }

  const metrics: Metric[] = [
    { title: "Active clients", value: clientsResult.count ?? 0, detail: "Client accounts", icon: Building2, tone: "brand" },
    { title: "Active websites", value: websitesResult.count ?? 0, detail: "Across your portfolio", icon: Globe2, tone: "green" },
    { title: "Expiring soon", value: expiringResult.count ?? 0, detail: "Within the next 30 days", icon: CalendarClock, tone: "amber" },
    { title: "Expired services", value: expiredResult.count ?? 0, detail: "Renewal needs attention", icon: AlertTriangle, tone: "red" },
    { title: "Websites down", value: outagesResult.count ?? 0, detail: "Confirmed open outages", icon: Activity, tone: "red" },
    { title: "Open incidents", value: incidentsResult.count ?? 0, detail: "Awaiting resolution", icon: CircleAlert, tone: "purple" },
    { title: "SSL attention", value: sslResult.count ?? 0, detail: "Expired or due within 30 days", icon: LockKeyhole, tone: "amber" },
    { title: "Notification failures", value: notificationFailuresResult.count ?? 0, detail: "In the last 7 days", icon: Bell, tone: "brand" },
  ];

  const links = [
    { name: "Overview", href: "/", icon: LayoutDashboard, active: true },
    { name: "Clients", href: "/clients", icon: Building2 },
    { name: "Websites", href: "/websites", icon: Globe2 },
    { name: "Infrastructure", href: "/inventory", icon: ShieldCheck },
    { name: "Incidents", href: "/incidents", icon: Activity },
    { name: "Notifications", href: "/notifications", icon: Bell },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col border-r border-slate-200 bg-white lg:flex">
        <Link href="/" className="flex h-[76px] items-center gap-3 border-b border-slate-100 px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600 text-white">
            <Activity size={19} strokeWidth={2.6} />
          </span>
          <span>
            <span className="block text-[15px] font-bold tracking-tight text-slate-950">monitor</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Client operations</span>
          </span>
        </Link>
        <div className="px-4 pt-7">
          <p className="px-3 pb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Workspace</p>
          <nav className="space-y-1" aria-label="Main navigation">
            {links.map(({ name, href, icon: Icon, active }) => (
              <Link
                key={name}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${
                  active ? "bg-red-50 text-red-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <Icon size={17} strokeWidth={1.8} />
                {name}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-8 px-4">
          <p className="px-3 pb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Manage</p>
          <nav className="space-y-1" aria-label="Workspace settings">
            <Link href="/calendar" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-950">
              <CalendarClock size={17} strokeWidth={1.8} /> Expiry calendar
            </Link>
            <Link href="/team" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-950">
              <Users size={17} strokeWidth={1.8} /> Team members
            </Link>
            <Link href="/settings" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-950">
              <Settings2 size={17} strokeWidth={1.8} /> Settings
            </Link>
          </nav>
        </div>
        <div className="mt-auto border-t border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-700">
              {context.email.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-800">{context.email}</p>
              <p className="text-[10px] capitalize text-slate-500">{context.role}</p>
            </div>
          </div>
          <form action={signOut}>
            <button className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-[248px]">
        <header className="flex h-[76px] items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-8">
          <div>
            <p className="text-xs font-medium text-slate-400">{context.organizationName}</p>
            <h1 className="text-lg font-bold tracking-tight text-slate-950">Overview</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-500 sm:flex">
              <Clock3 size={13} /> {context.timeZone}
            </span>
            <Link href="/team" aria-label="Team settings" className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50">
              <Users size={16} />
            </Link>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 sm:py-9">
          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-[22px] font-bold tracking-tight text-slate-950">Good {greeting()}, team</h2>
              <p className="mt-1 text-sm text-slate-500">Here&apos;s the latest health check across your client portfolio.</p>
            </div>
            <p className="text-xs text-slate-400">Updated {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone }).format(new Date())}</p>
          </div>

          <section aria-label="Portfolio metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(({ title, value, detail, icon: Icon, tone }) => (
              <div key={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500">{title}</p>
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg tone-${tone}`}>
                    <Icon size={16} strokeWidth={2} />
                  </span>
                </div>
                <p className="mt-3 text-[27px] font-bold leading-none tracking-tight text-slate-950">{value}</p>
                <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
              </div>
            ))}
          </section>

          <div className="mt-6 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Upcoming renewals</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">Services expiring in the next 30 days</p>
                </div>
                <Link href="/calendar" className="flex items-center gap-1 text-xs font-semibold text-red-700 hover:text-red-800">
                  View calendar <ArrowRight size={14} />
                </Link>
              </div>
              {upcomingResult.data?.length ? (
                <div className="divide-y divide-slate-100">
                  {upcomingResult.data.map((asset) => {
                    const rawWebsite = asset.website;
                    const website = Array.isArray(rawWebsite) ? rawWebsite[0] : rawWebsite;
                    const rawClient = website?.client;
                    const client = Array.isArray(rawClient) ? rawClient[0] : rawClient;
                    const days = daysRemaining(asset.expiry_date!, today);
                    return (
                      <div key={asset.id} className="flex items-center gap-3 px-5 py-3.5">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${days <= 7 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-500"}`}>
                          {days <= 7 ? <AlertTriangle size={16} /> : <CalendarClock size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-800">{asset.service_name || asset.hostname || asset.asset_type}</p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-400">{client?.name ?? "Client"} · {website?.name ?? "Website"}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-xs font-semibold ${days <= 7 ? "text-amber-700" : "text-slate-700"}`}>{days === 0 ? "Today" : `${days} days`}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">{displayDate(asset.expiry_date!, context.timeZone)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={21} /></span>
                  <p className="mt-3 text-sm font-semibold text-slate-800">No upcoming renewals</p>
                  <p className="mt-1 text-xs text-slate-400">Services due in the next 30 days will appear here.</p>
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Recent activity</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">Administrative and operational updates</p>
                </div>
                <Link href="/team" aria-label="View team activity" className="text-slate-400 hover:text-slate-700"><ArrowUpRight size={16} /></Link>
              </div>
              {activityResult.data?.length ? (
                <div className="divide-y divide-slate-100">
                  {activityResult.data.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-3 px-5 py-3.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"><Activity size={13} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-5 text-slate-700">{activity.action.replaceAll(".", " ")}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{activity.entity_type} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone }).format(new Date(activity.created_at))}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-50 text-slate-400"><Activity size={20} /></span>
                  <p className="mt-3 text-sm font-semibold text-slate-800">No activity yet</p>
                  <p className="mt-1 text-xs text-slate-400">Workspace activity will appear here.</p>
                </div>
              )}
            </section>
          </div>

          <div className="mt-5 flex flex-col gap-4 rounded-xl border border-red-100 bg-red-50/60 p-4 sm:flex-row sm:items-center">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-red-600"><LifeBuoy size={17} /></span>
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-800">Keep your team in the loop</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Invite authorized teammates to help manage client websites and renewals.</p>
            </div>
            <Link href="/team" className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-red-700">
              Manage team <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function DashboardLoading() {
  return (
    <main className="min-h-screen bg-white px-5 py-8 lg:pl-[280px]">
      <div className="mx-auto max-w-[1440px] animate-pulse">
        <div className="h-7 w-44 rounded bg-slate-200" />
        <div className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-28 rounded-xl border border-slate-200 bg-white" />)}
        </div>
        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          <div className="h-72 rounded-xl border border-slate-200 bg-white" />
          <div className="h-72 rounded-xl border border-slate-200 bg-white" />
        </div>
      </div>
    </main>
  );
}
