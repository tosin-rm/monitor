import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, CalendarClock, ExternalLink } from "lucide-react";
import { getAuthContext } from "@/lib/auth/session";
import { calendarDateInTimeZone, calendarDaysRemaining } from "@/lib/expiry/calendar-days";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Expiry calendar" };

export default function CalendarPage() {
  return <Suspense fallback={<CalendarLoading />}><CalendarContent /></Suspense>;
}

async function CalendarContent() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const today = calendarDateInTimeZone(new Date(), context.timeZone);
  const historyStart = new Date(`${today}T00:00:00Z`);
  historyStart.setUTCDate(historyStart.getUTCDate() - 30);
  const supabase = await createClient();
  const { data: assets, error } = await supabase
    .from("assets")
    .select("id, website_id, asset_type, service_name, hostname, expiry_date, renewal_url, renewal_responsibility, renewal_status, website:websites(name, client:clients(name))")
    .eq("organization_id", context.organizationId)
    .eq("active", true)
    .not("expiry_date", "is", "null")
    .gte("expiry_date", historyStart.toISOString().slice(0, 10))
    .order("expiry_date", { ascending: true })
    .limit(300);
  if (error) {
    console.error("Expiry calendar query failed", { code: error.code });
    throw new Error("Expiry calendar could not be loaded.");
  }

  const rows = (assets ?? []).map((asset) => ({
    ...asset,
    days: calendarDaysRemaining(asset.expiry_date!, new Date(), context.timeZone),
    website: Array.isArray(asset.website) ? asset.website[0] : asset.website,
  }));
  const pastDue = rows.filter((asset) => asset.days < 0);
  const upcoming = rows.filter((asset) => asset.days >= 0);

  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-5xl">
    <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Overview</Link>
    <div className="mt-6"><h1 className="text-xl font-bold tracking-tight text-slate-950">Expiry calendar</h1><p className="mt-1 text-sm text-slate-500">Upcoming infrastructure renewals and recently expired services · {context.timeZone} calendar dates.</p></div>

    {pastDue.length > 0 && <section className="mt-6 overflow-hidden rounded-xl border border-red-200 bg-white"><div className="border-b border-red-100 bg-red-50/60 px-5 py-4"><h2 className="text-sm font-bold text-red-800">Past expiry</h2><p className="mt-0.5 text-[11px] text-red-600">{pastDue.length} active services are past their recorded expiry date.</p></div><div className="divide-y divide-slate-100">{pastDue.map((asset) => <CalendarRow key={asset.id} asset={asset} timeZone={context.timeZone} />)}</div></section>}

    <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-bold text-slate-900">Upcoming renewals</h2><p className="mt-0.5 text-[11px] text-slate-400">Sorted by expiry date · services without a known date are listed in inventory.</p></div>
      {upcoming.length ? <div className="divide-y divide-slate-100">{upcoming.map((asset) => <CalendarRow key={asset.id} asset={asset} timeZone={context.timeZone} />)}</div> : <div className="px-6 py-14 text-center"><CalendarClock size={22} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No upcoming expiry dates recorded</p><p className="mt-1 text-xs text-slate-400">Add or verify service dates in the infrastructure inventory.</p><Link href="/inventory" className="mt-4 inline-flex text-xs font-semibold text-blue-700 hover:underline">Open inventory</Link></div>}
    </section>
  </div></main>;
}

function CalendarRow({ asset, timeZone }: {
  asset: {
    id: string;
    website_id: string;
    asset_type: string;
    service_name: string | null;
    hostname: string | null;
    expiry_date: string | null;
    renewal_url: string | null;
    renewal_responsibility: string | null;
    renewal_status: string;
    days: number;
    website: { name: string; client: { name: string } | { name: string }[] | null } | { name: string; client: { name: string } | { name: string }[] | null }[] | null;
  };
  timeZone: string;
}) {
  const website = Array.isArray(asset.website) ? asset.website[0] : asset.website;
  return <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${asset.days <= 7 ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}><CalendarClock size={17} /></span>
    <div className="min-w-0 flex-1"><Link href={`/websites/${asset.website_id}`} className="text-xs font-semibold text-slate-800 hover:text-blue-700">{asset.service_name || asset.hostname || asset.asset_type}</Link><p className="mt-1 truncate text-[10px] text-slate-400">{relationName(website?.client) ?? "Client"} · {website?.name ?? "Website"} · {asset.asset_type.replaceAll("_", " ")}</p><p className="mt-1 text-[10px] text-slate-500">Responsible: {asset.renewal_responsibility || "Unassigned"} · Status: {asset.renewal_status.replaceAll("_", " ")}</p></div>
    <div className="sm:text-right"><p className={`text-xs font-bold ${asset.days < 0 ? "text-red-700" : asset.days <= 7 ? "text-amber-700" : "text-slate-700"}`}>{asset.days < 0 ? `${Math.abs(asset.days)} days overdue` : asset.days === 0 ? "Expires today" : `${asset.days} ${asset.days === 1 ? "day" : "days"} remaining`}</p><p className="mt-1 text-[10px] text-slate-400">{asset.expiry_date ? new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone }).format(new Date(`${asset.expiry_date}T12:00:00Z`)) : ""}</p></div>
    {asset.renewal_url && <a href={asset.renewal_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 hover:underline">Renew <ExternalLink size={11} /></a>}
  </div>;
}

function relationName(value: unknown): string | null {
  if (Array.isArray(value)) return relationName(value[0]);
  if (value && typeof value === "object" && "name" in value && typeof value.name === "string") {
    return value.name;
  }
  return null;
}

function CalendarLoading() {
  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-8"><div className="mx-auto max-w-5xl animate-pulse"><div className="h-7 w-48 rounded bg-slate-200" /><div className="mt-7 h-96 rounded-xl border border-slate-200 bg-white" /></div></main>;
}
