import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, CalendarClock, ExternalLink, Search, ShieldCheck } from "lucide-react";
import { ConfirmSubmit } from "@/app/_components/confirm-submit";
import { AssetFields } from "@/app/_components/record-fields";
import { archiveAsset, confirmRenewal, updateAsset } from "@/app/websites/actions";
import { can } from "@/lib/auth/roles";
import { calendarDateInTimeZone, calendarDaysRemaining, calendarMonthBeforeDate } from "@/lib/expiry/calendar-days";
import { getRequestAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Infrastructure inventory" };

type Query = {
  type?: string;
  provider?: string;
  client?: string;
  expiry?: string;
  verification?: string;
  error?: string;
  success?: string;
};

type RenewalHistoryItem = {
  asset_id: string;
  previous_expiry_date: string | null;
  new_expiry_date: string | null;
  confirmation_method: string;
  confirmed_by: string | null;
  confirmation_notes: string | null;
  created_at: string;
};

export default function InventoryPage(props: { searchParams: Promise<Query> }) {
  return <Suspense fallback={<InventoryLoading />}><InventoryContent searchParams={props.searchParams} /></Suspense>;
}

async function InventoryContent({ searchParams }: { searchParams: Promise<Query> }) {
  const context = await getRequestAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const filters = await searchParams;
  const supabase = await createClient();
  const today = calendarDateInTimeZone(new Date(), context.timeZone);
  const soonDate = new Date(`${today}T00:00:00Z`);
  soonDate.setUTCDate(soonDate.getUTCDate() + 30);
  const limitDate = soonDate.toISOString().slice(0, 10);

  let assetsQuery = supabase
    .from("assets")
    .select("id, website_id, asset_type, provider_name, provider_account_reference, service_name, hostname, expiry_date, renewal_url, renewal_responsibility, renewal_status, date_source, date_confidence, last_verified_at, last_checked_at, last_check_error, website:websites!inner(id, name, client_id, active, client:clients!inner(name, active))")
    .eq("organization_id", context.organizationId)
    .eq("active", true)
    .eq("website.active", true)
    .eq("website.client.active", true)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .limit(500);
  if (filters.type && ["domain", "hosting", "ssl_certificate", "other"].includes(filters.type)) {
    assetsQuery = assetsQuery.eq("asset_type", filters.type);
  }
  if (filters.provider?.trim()) {
    assetsQuery = assetsQuery.ilike("provider_name", `%${filters.provider.trim().slice(0, 80).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  }
  if (filters.client) assetsQuery = assetsQuery.eq("website.client_id", filters.client);
  if (filters.verification === "verified") assetsQuery = assetsQuery.not("last_verified_at", "is", "null");
  if (filters.verification === "unverified") assetsQuery = assetsQuery.is("last_verified_at", null);
  if (filters.expiry === "unknown") assetsQuery = assetsQuery.is("expiry_date", null);
  if (filters.expiry === "expired") assetsQuery = assetsQuery.lt("expiry_date", today);
  if (filters.expiry === "soon") assetsQuery = assetsQuery.gte("expiry_date", today).lte("expiry_date", limitDate);
  if (filters.expiry === "later") assetsQuery = assetsQuery.gt("expiry_date", limitDate);

  const [assetsResult, clientsResult] = await Promise.all([
    assetsQuery,
    supabase.from("clients").select("id, name").eq("organization_id", context.organizationId).eq("active", true).order("name"),
  ]);
  if (assetsResult.error || clientsResult.error) {
    console.error("Infrastructure inventory query failed", [assetsResult.error?.code, clientsResult.error?.code].filter(Boolean));
    throw new Error("Infrastructure inventory could not be loaded.");
  }
  const assets = assetsResult.data ?? [];
  const assetIds = assets.map((asset) => asset.id);
  const historyResult = assetIds.length
    ? await supabase.from("renewal_history").select("asset_id, previous_expiry_date, new_expiry_date, confirmation_method, confirmed_by, confirmation_notes, created_at").eq("organization_id", context.organizationId).in("asset_id", assetIds).order("created_at", { ascending: false }).limit(250)
    : { data: [], error: null };
  if (historyResult.error) {
    console.error("Renewal history query failed", { code: historyResult.error.code });
    throw new Error("Renewal history could not be loaded.");
  }
  const histories = new Map<string, RenewalHistoryItem[]>();
  for (const entry of historyResult.data ?? []) {
    const current = histories.get(entry.asset_id) ?? [];
    current.push(entry);
    histories.set(entry.asset_id, current);
  }

  return <main className="min-h-screen bg-white px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-7xl">
    <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Overview</Link>
    <div className="mt-6"><h1 className="text-xl font-bold tracking-tight text-slate-950">Infrastructure inventory</h1><p className="mt-1 text-sm text-slate-500">Domains, hosting subscriptions, certificates, and manually verified renewal dates.</p></div>
    {filters.error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{filters.error === "forbidden" ? "Your role cannot manage infrastructure." : filters.error === "invalid" ? "Check the expiry date and service details." : filters.error === "renewal" ? "Renewal could not be recorded. Verify that this asset belongs to your organization." : "The inventory change could not be saved."}</p>}
    {filters.success === "renewed" && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">Renewal confirmation saved. The new expiry date begins a new reminder schedule.</p>}

    <form action="/inventory" className="mt-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
      <div><label htmlFor="type" className="mb-1.5 block text-[10px] font-semibold text-slate-600">Service type</label><select id="type" name="type" defaultValue={filters.type ?? ""} className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="">All types</option>{[["domain", "Domain"], ["hosting", "Hosting"], ["ssl_certificate", "SSL"], ["other", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div><label htmlFor="provider" className="mb-1.5 block text-[10px] font-semibold text-slate-600">Provider</label><input id="provider" name="provider" defaultValue={filters.provider} className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs" placeholder="Provider name" /></div>
      <div><label htmlFor="client" className="mb-1.5 block text-[10px] font-semibold text-slate-600">Client</label><select id="client" name="client" defaultValue={filters.client ?? ""} className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="">All clients</option>{clientsResult.data?.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>
      <div><label htmlFor="expiry" className="mb-1.5 block text-[10px] font-semibold text-slate-600">Expiry status</label><select id="expiry" name="expiry" defaultValue={filters.expiry ?? ""} className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="">All statuses</option><option value="soon">Within 30 days</option><option value="expired">Expired</option><option value="later">Later</option><option value="unknown">Unknown date</option></select></div>
      <div><label htmlFor="verification" className="mb-1.5 block text-[10px] font-semibold text-slate-600">Verification</label><select id="verification" name="verification" defaultValue={filters.verification ?? ""} className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="">All</option><option value="verified">Verified</option><option value="unverified">Needs verification</option></select></div>
      <div className="flex items-end gap-2"><button type="submit" className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-red-600 px-2 text-xs font-semibold text-white hover:bg-red-700"><Search size={13} /> Filter</button><Link href="/inventory" className="flex h-9 items-center rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">Clear</Link></div>
    </form>

    <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Tracked services</h2><p className="mt-0.5 text-[11px] text-slate-400">{assets.length} assets · dates shown in {context.timeZone}</p></div><ShieldCheck size={16} className="text-slate-400" /></div>
      {assets.length ? <div className="divide-y divide-slate-100">
        {assets.map((asset) => {
          const website = Array.isArray(asset.website) ? asset.website[0] : asset.website;
          const days = asset.expiry_date ? calendarDaysRemaining(asset.expiry_date, new Date(), context.timeZone) : null;
          const title = asset.service_name || asset.hostname || asset.asset_type;
          const history = histories.get(asset.id) ?? [];
          return <article key={asset.id} className="px-5 py-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
              <div className="flex min-w-0 flex-1 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700"><ShieldCheck size={16} /></span><div className="min-w-0 flex-1"><Link href={`/websites/${asset.website_id}`} className="text-xs font-semibold text-slate-800 hover:text-red-700">{title}</Link><p className="mt-1 truncate text-[10px] text-slate-400"><Link href={`/clients`} className="hover:underline">{relationName(website?.client) ?? "Client"}</Link> · <Link href={`/websites/${asset.website_id}`} className="hover:underline">{website?.name ?? "Website"}</Link> · {asset.asset_type.replaceAll("_", " ")}</p><p className="mt-1 truncate text-[10px] text-slate-500">{asset.provider_name ?? "Provider not recorded"}{asset.provider_account_reference ? ` · ${asset.provider_account_reference}` : ""}{asset.renewal_responsibility ? ` · Responsible: ${asset.renewal_responsibility}` : ""}</p></div></div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-[10px] xl:min-w-[280px]">
                <span className="text-slate-400">Expiry</span><strong className={`font-semibold ${days !== null && days < 0 ? "text-red-700" : days !== null && days <= 14 ? "text-amber-700" : "text-slate-700"}`}>{asset.expiry_date ? `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: context.timeZone }).format(new Date(`${asset.expiry_date}T12:00:00Z`))}${days! < 0 ? ` · ${Math.abs(days!)}d overdue` : ` · ${days}d`}` : "Unknown"}</strong>
                <span className="text-slate-400">Reminder date (1 month before)</span><strong className="font-semibold text-slate-700">{asset.expiry_date && asset.renewal_status !== "cancelled" ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${calendarMonthBeforeDate(asset.expiry_date)}T12:00:00Z`)) : "Not scheduled"}</strong>
                <span className="text-slate-400">Renewal status</span><strong className="font-semibold capitalize text-slate-700">{asset.renewal_status.replaceAll("_", " ")}</strong>
                <span className="text-slate-400">Date source / confidence</span><strong className="font-semibold capitalize text-slate-700">{asset.date_source} / {asset.date_confidence ?? "unknown"}</strong>
                <span className="text-slate-400">Last verified</span><strong className="font-semibold text-slate-700">{asset.last_verified_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: context.timeZone }).format(new Date(asset.last_verified_at)) : "Not verified"}</strong>
                <span className="text-slate-400">Last check attempt</span><strong className="font-semibold text-slate-700">{asset.last_checked_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: context.timeZone }).format(new Date(asset.last_checked_at)) : "Not checked"}</strong>
              </div>
              {asset.renewal_url && <a href={asset.renewal_url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-red-700 hover:underline">Renew <ExternalLink size={11} /></a>}
            </div>
            {asset.last_check_error && <p className="ml-12 mt-2 text-[10px] text-amber-700">Latest check issue: {asset.last_check_error}</p>}

            <div className="ml-12 mt-3 flex flex-wrap items-center gap-4">
              {can(context.role, "confirm_renewals") && <details><summary className="cursor-pointer text-[10px] font-semibold text-red-700">Confirm renewal</summary><form action={confirmRenewal} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="websiteId" value={asset.website_id} /><div><label htmlFor={`new-date-${asset.id}`} className="mb-1 block text-[10px] text-slate-500">New expiry date</label><input id={`new-date-${asset.id}`} name="newExpiryDate" type="date" required className="h-8 rounded-md border border-slate-200 px-2 text-[11px]" /></div><div><label htmlFor={`renewal-notes-${asset.id}`} className="mb-1 block text-[10px] text-slate-500">Notes</label><input id={`renewal-notes-${asset.id}`} name="notes" maxLength={1000} className="h-8 rounded-md border border-slate-200 px-2 text-[11px]" /></div><button type="submit" className="h-8 rounded-md bg-red-600 px-3 text-[11px] font-semibold text-white">Record</button></form></details>}
              {can(context.role, "manage_assets") && <details><summary className="cursor-pointer text-[10px] font-semibold text-slate-500">Edit service details</summary><form action={updateAsset} className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-3"><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="websiteId" value={asset.website_id} /><AssetFields asset={asset} idPrefix={`edit-${asset.id}`} /><button type="submit" className="h-9 rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 sm:col-span-2 xl:col-span-3">Save service</button></form></details>}
              {can(context.role, "manage_assets") && <form action={archiveAsset}><input type="hidden" name="assetId" value={asset.id} /><ConfirmSubmit type="submit" confirmation={`Archive ${title}? Its check and renewal history will be retained.`} className="text-[10px] font-semibold text-red-600 hover:underline">Archive</ConfirmSubmit></form>}
              {history.length > 0 && <details><summary className="cursor-pointer text-[10px] font-semibold text-slate-500">Renewal history ({history.length})</summary><div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-3">{history.map((entry, index) => <p key={`${entry.created_at}-${index}`} className="text-[10px] leading-4 text-slate-600">{entry.previous_expiry_date ?? "No prior date"} → {entry.new_expiry_date ?? "Unknown"} · {entry.confirmation_method} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: context.timeZone }).format(new Date(entry.created_at))}{entry.confirmation_notes ? ` · ${entry.confirmation_notes}` : ""}</p>)}</div></details>}
            </div>
          </article>;
        })}
      </div> : <div className="px-6 py-14 text-center"><CalendarClock size={22} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No services match these filters</p><p className="mt-1 text-xs text-slate-400">Add infrastructure from a website details page.</p></div>}
    </section>
  </div></main>;
}

function relationName(value: unknown): string | null {
  if (Array.isArray(value)) return relationName(value[0]);
  if (value && typeof value === "object" && "name" in value && typeof value.name === "string") {
    return value.name;
  }
  return null;
}

function InventoryLoading() {
  return <main className="min-h-screen bg-white px-5 py-8"><div className="mx-auto max-w-7xl animate-pulse"><div className="h-7 w-52 rounded bg-slate-200" /><div className="mt-7 h-20 rounded-xl border border-slate-200 bg-white" /><div className="mt-5 h-[600px] rounded-xl border border-slate-200 bg-white" /></div></main>;
}
