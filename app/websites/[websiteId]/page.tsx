import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, CalendarClock, ExternalLink, Globe2, LockKeyhole, Plus, ShieldCheck } from "lucide-react";
import { ConfirmSubmit } from "@/app/_components/confirm-submit";
import { AssetFields, WebsiteFields } from "@/app/_components/record-fields";
import { archiveAsset, archiveWebsite, confirmRenewal, createAsset, createMonitoringEndpoint, setMonitoringEndpoint, updateWebsite } from "@/app/websites/actions";
import { can } from "@/lib/auth/roles";
import { calendarDaysRemaining } from "@/lib/expiry/calendar-days";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Website details" };

export default function WebsiteDetailPage(props: { params: Promise<{ websiteId: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  return <Suspense fallback={<WebsiteLoading />}><WebsiteDetailContent params={props.params} searchParams={props.searchParams} /></Suspense>;
}

async function WebsiteDetailContent({ params, searchParams }: { params: Promise<{ websiteId: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const [{ websiteId }, paramsResult] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const [websiteResult, clientsResult, assetsResult, endpointsResult, incidentsResult] = await Promise.all([
    supabase.from("websites").select("id, client_id, name, primary_url, environment, active, client:clients(name)").eq("id", websiteId).eq("organization_id", context.organizationId).eq("active", true).maybeSingle(),
    can(context.role, "manage_websites") ? supabase.from("clients").select("id, name").eq("organization_id", context.organizationId).eq("active", true).order("name") : Promise.resolve({ data: [], error: null }),
    supabase.from("assets").select("id, asset_type, provider_name, provider_account_reference, service_name, hostname, expiry_date, renewal_url, renewal_responsibility, renewal_status, date_source, last_verified_at, last_checked_at, last_check_error, date_confidence").eq("website_id", websiteId).eq("organization_id", context.organizationId).eq("active", true).order("expiry_date", { ascending: true, nullsFirst: false }),
    supabase.from("monitoring_endpoints").select("id, endpoint_url, enabled, check_interval_seconds, timeout_seconds, last_checked_at, last_success_at, last_failure_at, consecutive_failures, consecutive_failure_threshold").eq("website_id", websiteId).eq("organization_id", context.organizationId).order("created_at"),
    supabase.from("incidents").select("id, incident_type, severity, status, started_at, last_observed_at, summary").eq("website_id", websiteId).eq("organization_id", context.organizationId).in("status", ["open", "acknowledged", "investigating"]).order("started_at", { ascending: false }).limit(10),
  ]);
  const errors = [websiteResult.error, clientsResult.error, assetsResult.error, endpointsResult.error, incidentsResult.error].filter(Boolean);
  if (errors.length) {
    console.error("Website detail query failed", errors.map((error) => error?.code));
    throw new Error("Website information could not be loaded.");
  }
  if (!websiteResult.data) notFound();
  const website = websiteResult.data;
  const client = Array.isArray(website.client) ? website.client[0] : website.client;
  const endpoints = endpointsResult.data ?? [];
  const endpointIds = endpoints.map((endpoint) => endpoint.id);
  const historyResult = endpointIds.length
    ? await supabase.from("check_results").select("endpoint_id, checked_at, success, http_status, response_time_ms, sanitized_error_message").eq("organization_id", context.organizationId).in("endpoint_id", endpointIds).order("checked_at", { ascending: false }).limit(12)
    : { data: [], error: null };
  if (historyResult.error) {
    console.error("Endpoint history query failed", { code: historyResult.error.code });
    throw new Error("Website monitoring history could not be loaded.");
  }
  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-6xl">
    <Link href="/websites" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Websites</Link>
    <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium text-slate-400">{client?.name ?? "Client"} · <span className="capitalize">{website.environment}</span></p><h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950">{website.name}</h1><a href={website.primary_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">{website.primary_url}<ExternalLink size={12} /></a></div><span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active website</span></div>
    {paramsResult.error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{websiteError(paramsResult.error)}</p>}
    {paramsResult.success && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">{paramsResult.success === "renewed" ? "Renewal recorded and reminder schedule updated." : "Website information saved."}</p>}

    <div className="mt-6 grid gap-5 xl:grid-cols-[1.3fr_1fr]">
      <div className="space-y-5">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Infrastructure services</h2><p className="mt-0.5 text-[11px] text-slate-400">{assetsResult.data?.length ?? 0} active assets · dates use {context.timeZone}</p></div><ShieldCheck size={16} className="text-slate-400" /></div>
          {assetsResult.data?.length ? <div className="divide-y divide-slate-100">{assetsResult.data.map((asset) => {
            const days = asset.expiry_date ? calendarDaysRemaining(asset.expiry_date, new Date(), context.timeZone) : null;
            const display = asset.service_name || asset.hostname || asset.asset_type;
            return <div key={asset.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${asset.asset_type === "ssl_certificate" ? "bg-violet-50 text-violet-700" : "bg-slate-50 text-slate-600"}`}>{asset.asset_type === "ssl_certificate" ? <LockKeyhole size={16} /> : <ShieldCheck size={16} />}</span>
                <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-800">{display}</p><p className="mt-1 text-[10px] text-slate-400">{asset.asset_type.replaceAll("_", " ")}{asset.provider_name ? ` · ${asset.provider_name}` : ""}{asset.provider_account_reference ? ` · ${asset.provider_account_reference}` : ""}</p></div>
                <div className="text-right">{asset.expiry_date ? <><p className={`text-xs font-semibold ${days !== null && days < 0 ? "text-red-700" : days !== null && days <= 14 ? "text-amber-700" : "text-slate-700"}`}>{days! < 0 ? `${Math.abs(days!)} days overdue` : days === 0 ? "Expires today" : `${days} days left`}</p><p className="mt-1 text-[10px] text-slate-400">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: context.timeZone }).format(new Date(`${asset.expiry_date}T12:00:00Z`))}</p></> : <p className="text-xs text-slate-400">Expiry unknown</p>}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pl-12 text-[10px] text-slate-400"><span>Status: <strong className="font-semibold capitalize text-slate-600">{asset.renewal_status.replaceAll("_", " ")}</strong> · Date source: {asset.date_source}{asset.last_verified_at ? ` · Verified ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: context.timeZone }).format(new Date(asset.last_verified_at))}` : ""}</span>
                {asset.renewal_url && <a href={asset.renewal_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline">Renew service <ExternalLink size={11} /></a>}
              </div>
              {(can(context.role, "confirm_renewals") || can(context.role, "manage_assets")) && <details className="ml-12 mt-3"><summary className="cursor-pointer text-[10px] font-semibold text-blue-700">Confirm renewal</summary><form action={confirmRenewal} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="websiteId" value={website.id} /><div><label htmlFor={`expiry-${asset.id}`} className="mb-1 block text-[10px] font-medium text-slate-500">New verified expiry</label><input id={`expiry-${asset.id}`} name="newExpiryDate" type="date" required className="h-8 rounded-md border border-slate-200 px-2 text-[11px]" /></div><div className="min-w-0 flex-1"><label htmlFor={`notes-${asset.id}`} className="mb-1 block text-[10px] font-medium text-slate-500">Confirmation notes</label><input id={`notes-${asset.id}`} name="notes" maxLength={1000} className="h-8 w-full rounded-md border border-slate-200 px-2 text-[11px]" placeholder="Optional" /></div><button type="submit" className="h-8 rounded-md bg-blue-600 px-3 text-[11px] font-semibold text-white hover:bg-blue-700">Record</button></form></details>}
              {can(context.role, "manage_assets") && <form action={archiveAsset} className="ml-12 mt-2"><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="websiteId" value={website.id} /><ConfirmSubmit type="submit" confirmation={`Archive ${display}? Monitoring records and renewal history will be retained.`} className="text-[10px] font-semibold text-red-600 hover:underline">Archive asset</ConfirmSubmit></form>}
            </div>;
          })}</div> : <p className="px-5 py-8 text-xs text-slate-400">No infrastructure assets have been added.</p>}
          {can(context.role, "manage_assets") && <details className="border-t border-slate-100 px-5 py-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-blue-700"><Plus size={14} /> Add service asset</summary><form action={createAsset} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="websiteId" value={website.id} /><AssetFields /><button type="submit" className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 sm:col-span-2">Save service</button></form></details>}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Uptime endpoints</h2><p className="mt-0.5 text-[11px] text-slate-400">Checks will run independently on the monitoring schedule.</p></div><Globe2 size={16} className="text-slate-400" /></div>
          {endpoints.length ? <div className="divide-y divide-slate-100">{endpoints.map((endpoint) => {
            const down = endpoint.consecutive_failures >= endpoint.consecutive_failure_threshold;
            return <div key={endpoint.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5"><span className={`h-2 w-2 rounded-full ${!endpoint.enabled ? "bg-slate-300" : down ? "bg-red-500" : endpoint.last_success_at ? "bg-emerald-500" : "bg-amber-400"}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{endpoint.endpoint_url}</p><p className="mt-1 text-[10px] text-slate-400">{!endpoint.enabled ? "Disabled" : down ? `Down · ${endpoint.consecutive_failures} consecutive failures` : endpoint.last_success_at ? `Healthy · checked ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone }).format(new Date(endpoint.last_success_at))}` : "Awaiting first check"} · every {Math.round(endpoint.check_interval_seconds / 60)} min</p></div>
              {can(context.role, "manage_monitoring") && <form action={setMonitoringEndpoint}><input type="hidden" name="endpointId" value={endpoint.id} /><input type="hidden" name="websiteId" value={website.id} /><input type="hidden" name="enabled" value={String(!endpoint.enabled)} /><button type="submit" className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">{endpoint.enabled ? "Disable" : "Enable"}</button></form>}
            </div>;
          })}</div> : <p className="px-5 py-8 text-xs text-slate-400">No uptime checks are configured.</p>}
          {can(context.role, "manage_monitoring") && <details className="border-t border-slate-100 px-5 py-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-blue-700"><Plus size={14} /> Add uptime endpoint</summary><form action={createMonitoringEndpoint} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="websiteId" value={website.id} /><div className="sm:col-span-2"><label htmlFor="endpointUrl" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Public HTTP(S) URL</label><input id="endpointUrl" name="endpointUrl" type="url" required maxLength={2048} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-blue-500" placeholder="https://example.com/health" /></div><div><label htmlFor="checkInterval" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Interval (seconds)</label><input id="checkInterval" name="checkInterval" type="number" min={60} max={86400} defaultValue={300} required className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" /></div><div><label htmlFor="timeout" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Timeout (seconds)</label><input id="timeout" name="timeout" type="number" min={1} max={60} defaultValue={15} required className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" /></div><button type="submit" className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 sm:col-span-2">Create endpoint</button></form></details>}
        </section>
      </div>

      <div className="space-y-5">
        {can(context.role, "manage_websites") && <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-sm font-bold text-slate-900">Website settings</h2><form action={updateWebsite} className="mt-4 space-y-3"><input type="hidden" name="websiteId" value={website.id} /><WebsiteFields clients={clientsResult.data ?? []} website={{ name: website.name, primary_url: website.primary_url, environment: website.environment, client_id: website.client_id }} /><button type="submit" className="h-9 w-full rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700">Save website</button></form><form action={archiveWebsite} className="mt-4 border-t border-slate-100 pt-4"><input type="hidden" name="websiteId" value={website.id} /><ConfirmSubmit type="submit" confirmation={`Archive ${website.name}? Its assets and endpoints will be disabled without deleting their history.`} className="h-9 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50">Archive website</ConfirmSubmit></form></section>}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-bold text-slate-900">Open incidents</h2></div>
          {incidentsResult.data?.length ? <div className="divide-y divide-slate-100">{incidentsResult.data.map((incident) => <div key={incident.id} className="px-5 py-3.5"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{incident.summary}</p><span className="text-[10px] capitalize text-amber-700">{incident.severity}</span></div><p className="mt-1 text-[10px] capitalize text-slate-400">{incident.incident_type.replaceAll("_", " ")} · {incident.status} · started {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: context.timeZone }).format(new Date(incident.started_at))}</p></div>)}</div> : <p className="px-5 py-7 text-xs text-slate-400">No open incidents.</p>}
          <div className="border-t border-slate-100 px-5 py-3"><Link href="/incidents" className="text-xs font-semibold text-blue-700 hover:underline">View incident timeline</Link></div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><CalendarClock size={15} className="text-slate-400" /><h2 className="text-sm font-bold text-slate-900">Recent check results</h2></div>
          {historyResult.data?.length ? <div className="divide-y divide-slate-100">{historyResult.data.map((check, index) => <div key={`${check.endpoint_id}-${check.checked_at}-${index}`} className="flex items-center gap-2 px-5 py-3"><span className={`h-2 w-2 rounded-full ${check.success ? "bg-emerald-500" : "bg-red-500"}`} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-slate-700">{check.success ? `HTTP ${check.http_status ?? "OK"}` : check.sanitized_error_message ?? `HTTP ${check.http_status ?? "failure"}`}</p><p className="mt-0.5 text-[10px] text-slate-400">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone }).format(new Date(check.checked_at))}</p></div><span className="text-[10px] text-slate-500">{check.response_time_ms === null ? "—" : `${check.response_time_ms} ms`}</span></div>)}</div> : <p className="px-5 py-7 text-xs text-slate-400">No completed checks to show yet.</p>}
        </section>
      </div>
    </div>
  </div></main>;
}

function websiteError(error: string): string {
  if (error === "asset") return "The service asset was not saved. Check the type, hostname, expiry date, and renewal URL.";
  if (error === "endpoint") return "The endpoint was not saved. Use a public HTTP(S) URL on port 80 or 443 and valid check settings.";
  if (error === "archive") return "The website could not be archived.";
  return "Website or renewal changes could not be saved.";
}

function WebsiteLoading() {
  return <main className="min-h-screen bg-[#f5f7fa] p-8"><div className="mx-auto h-[700px] max-w-6xl animate-pulse rounded-xl bg-white" /></main>;
}
