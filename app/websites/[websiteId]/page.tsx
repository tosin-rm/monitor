import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Activity, ArrowLeft, CalendarClock, ChevronDown, ExternalLink, Globe2, LockKeyhole, Plus, ShieldCheck, Zap } from "lucide-react";
import { DismissibleNotice } from "@/app/_components/dismissible-notice";
import { ConfirmSubmit } from "@/app/_components/confirm-submit";
import { LifecycleStatusForm } from "@/app/_components/lifecycle-status-form";
import { WordPressSecurityPanel } from "@/app/websites/[websiteId]/wordpress-security-panel";
import { AssetFields, WebsiteFields } from "@/app/_components/record-fields";
import { archiveAsset, confirmRenewal, createAsset, createMonitoringEndpoint, removeMonitoringEndpoint, setMonitoringEndpoint, updateWebsite, updateWebsiteLifecycle } from "@/app/websites/actions";
import { can } from "@/lib/auth/roles";
import { calendarDaysRemaining } from "@/lib/expiry/calendar-days";
import { getRequestAuthContext } from "@/lib/auth/session";
import { effectiveWebsiteStatus, lifecycleLabel, type LifecycleStatus } from "@/lib/lifecycle/status";
import { isConnectorReportStale } from "@/lib/wordpress-connector/status";
import { getCentralVulnerabilityAssessment } from "@/lib/wordpress-connector/vulnerability-assessment";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Website details" };

export default function WebsiteDetailPage(props: { params: Promise<{ websiteId: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  return <Suspense fallback={<WebsiteLoading />}><WebsiteDetailContent params={props.params} searchParams={props.searchParams} /></Suspense>;
}

async function WebsiteDetailContent({ params, searchParams }: { params: Promise<{ websiteId: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const context = await getRequestAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const [{ websiteId }, paramsResult] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const [websiteResult, clientsResult, assetsResult, endpointsResult, incidentsResult, performanceResult, connectorResult] = await Promise.all([
    supabase.from("websites").select("id, client_id, name, primary_url, environment, platform, lifecycle_status, client:clients(name, lifecycle_status)").eq("id", websiteId).eq("organization_id", context.organizationId).maybeSingle(),
    can(context.role, "manage_websites") ? supabase.from("clients").select("id, name, lifecycle_status").eq("organization_id", context.organizationId).order("name") : Promise.resolve({ data: [], error: null }),
    supabase.from("assets").select("id, asset_type, provider_name, provider_account_reference, service_name, hostname, expiry_date, renewal_url, renewal_responsibility, renewal_status, date_source, last_verified_at, last_checked_at, last_check_error, date_confidence").eq("website_id", websiteId).eq("organization_id", context.organizationId).eq("active", true).order("expiry_date", { ascending: true, nullsFirst: false }),
    supabase.from("monitoring_endpoints").select("id, endpoint_url, enabled, check_interval_seconds, timeout_seconds, last_checked_at, last_success_at, last_failure_at, consecutive_failures, consecutive_failure_threshold").eq("website_id", websiteId).eq("organization_id", context.organizationId).order("created_at"),
    supabase.from("incidents").select("id, incident_type, severity, status, started_at, last_observed_at, summary").eq("website_id", websiteId).eq("organization_id", context.organizationId).in("status", ["open", "acknowledged", "investigating"]).order("started_at", { ascending: false }).limit(10),
    supabase.from("check_results").select("id, checked_at, success, error_code, sanitized_error_message, metadata").eq("website_id", websiteId).eq("organization_id", context.organizationId).eq("check_type", "performance").order("checked_at", { ascending: false }).limit(10),
    supabase.from("wordpress_connectors").select("id, status, paired_at, last_report_at, last_error_code").eq("website_id", websiteId).eq("organization_id", context.organizationId).maybeSingle(),
  ]);
  const errors = [websiteResult.error, clientsResult.error, assetsResult.error, endpointsResult.error, incidentsResult.error, performanceResult.error, connectorResult.error].filter(Boolean);
  if (errors.length) {
    console.error("Website detail query failed", errors.map((error) => error?.code));
    throw new Error("Website information could not be loaded.");
  }
  if (!websiteResult.data) notFound();
  const website = websiteResult.data;
  const wordpressLatestResult = website.platform === "wordpress" && connectorResult.data?.status === "active"
    ? await supabase.from("wordpress_connector_reports").select("collected_at, wordpress_version, plugins, spam_comment_count, security_report, schema_version").eq("website_id", websiteId).eq("organization_id", context.organizationId).order("received_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null };
  if (wordpressLatestResult.error) {
    console.error("WordPress connector report query failed", { code: wordpressLatestResult.error.code });
    throw new Error("WordPress security information could not be loaded.");
  }
  const latestWordPressInventory = wordpressLatestResult.data as { plugins: Array<{ slug: string; version: string }> } | null;
  const centralVulnerability = website.platform === "wordpress" && latestWordPressInventory
    ? await getCentralVulnerabilityAssessment(latestWordPressInventory.plugins ?? [])
    : null;
  const client = Array.isArray(website.client) ? website.client[0] : website.client;
  const lifecycleStatus = effectiveWebsiteStatus(
    website.lifecycle_status as LifecycleStatus,
    (client?.lifecycle_status ?? "active") as LifecycleStatus,
  );
  const monitoringPaused = lifecycleStatus !== "active";
  const endpoints = endpointsResult.data ?? [];
  const endpointIds = endpoints.map((endpoint) => endpoint.id);
  const performanceChecks = performanceResult.data ?? [];
  const latestPerformance = performanceChecks[0];
  const performanceMetrics = latestPerformance?.metadata as Record<string, string | number | null> | undefined;
  const since24h = getSince24Hours();
  const recentHttpChecks = endpointIds.length
    ? await supabase.from("check_results").select("success, response_time_ms, checked_at, error_code")
      .eq("organization_id", context.organizationId).in("endpoint_id", endpointIds)
      .eq("check_type", "http").gte("checked_at", since24h).order("checked_at", { ascending: false }).limit(500)
    : { data: [], error: null };
  if (recentHttpChecks.error) {
    console.error("Website health summary query failed", { code: recentHttpChecks.error.code });
    throw new Error("Website health history could not be loaded.");
  }
  // A missing response tells us the monitor could not confirm site status; it
  // must not be counted as an outage in the availability estimate.
  const uncertainTransportErrors = ["network_failure", "timeout"];
  const httpChecks = (recentHttpChecks.data ?? []).filter((check) => !uncertainTransportErrors.includes(check.error_code ?? ""));
  const uptimePercent = httpChecks.length
    ? (httpChecks.filter((check) => check.success).length / httpChecks.length) * 100
    : null;
  const responseTimes = httpChecks.map((check) => check.response_time_ms).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const averageResponseMs = responseTimes.length ? Math.round(responseTimes.reduce((total, value) => total + value, 0) / responseTimes.length) : null;
  const p95ResponseMs = responseTimes.length ? responseTimes[Math.min(responseTimes.length - 1, Math.ceil(responseTimes.length * 0.95) - 1)] : null;
  const certificateAssets = (assetsResult.data ?? []).filter((asset) => asset.asset_type === "ssl_certificate");
  const certificateChecks = certificateAssets.length
    ? await supabase.from("check_results").select("id, checked_at, success, certificate_not_after, sanitized_error_message, metadata, asset_id")
      .eq("organization_id", context.organizationId).in("asset_id", certificateAssets.map((asset) => asset.id))
      .eq("check_type", "ssl").order("checked_at", { ascending: false }).limit(20)
    : { data: [], error: null };
  if (certificateChecks.error) {
    console.error("Website certificate history query failed", { code: certificateChecks.error.code });
    throw new Error("Website certificate history could not be loaded.");
  }
  const httpsEndpoints = endpoints.filter((endpoint) => {
    if (!endpoint.enabled) return false;
    try { return new URL(endpoint.endpoint_url).protocol === "https:"; } catch { return false; }
  });
  const endpointCertificateChecks = httpsEndpoints.length
    ? await supabase.from("check_results").select("id, checked_at, success, certificate_not_after, sanitized_error_message, metadata, endpoint_id")
      .eq("organization_id", context.organizationId).in("endpoint_id", httpsEndpoints.map((endpoint) => endpoint.id))
      .eq("check_type", "ssl").order("checked_at", { ascending: false }).limit(100)
    : { data: [], error: null };
  if (endpointCertificateChecks.error) {
    console.error("Endpoint certificate history query failed", { code: endpointCertificateChecks.error.code });
    throw new Error("Endpoint certificate history could not be loaded.");
  }
  const latestCertificateByAsset = new Map<string, NonNullable<typeof certificateChecks.data>[number]>();
  for (const check of certificateChecks.data ?? []) {
    if (check.asset_id && !latestCertificateByAsset.has(check.asset_id)) latestCertificateByAsset.set(check.asset_id, check);
  }
  const latestCertificateByEndpoint = new Map<string, NonNullable<typeof endpointCertificateChecks.data>[number]>();
  for (const check of endpointCertificateChecks.data ?? []) {
    if (check.endpoint_id && !latestCertificateByEndpoint.has(check.endpoint_id)) latestCertificateByEndpoint.set(check.endpoint_id, check);
  }
  const latestCertificateChecks = [
    ...latestCertificateByAsset.values(),
    ...latestCertificateByEndpoint.values(),
  ];
  const certificateTargetCount = certificateAssets.length + httpsEndpoints.length;
  const historyResult = endpointIds.length
    ? await supabase.from("check_results").select("endpoint_id, checked_at, success, http_status, response_time_ms, error_code, sanitized_error_message").eq("organization_id", context.organizationId).in("endpoint_id", endpointIds).order("checked_at", { ascending: false }).limit(500)
    : { data: [], error: null };
  if (historyResult.error) {
    console.error("Endpoint history query failed", { code: historyResult.error.code });
    throw new Error("Website monitoring history could not be loaded.");
  }
  const latestEndpointChecks = new Map<string, NonNullable<typeof historyResult.data>[number]>();
  for (const check of historyResult.data ?? []) {
    if (check.endpoint_id && !latestEndpointChecks.has(check.endpoint_id)) latestEndpointChecks.set(check.endpoint_id, check);
  }
  const healthWarning = endpoints.some((endpoint) => {
    if (!endpoint.enabled) return false;
    const latest = latestEndpointChecks.get(endpoint.id);
    return endpoint.consecutive_failures >= endpoint.consecutive_failure_threshold
      || Boolean(latest && !latest.success && !uncertainTransportErrors.includes(latest.error_code ?? ""));
  }) || latestCertificateChecks.some((check) => !check.success);
  const healthLabel = monitoringPaused ? "Monitoring paused" : healthWarning ? "Needs attention" : endpoints.some((endpoint) => endpoint.enabled) || certificateTargetCount ? "Monitoring active" : "No checks configured";
  return <main className="min-h-screen bg-white px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-6xl">
    <Link href="/websites" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Websites</Link>
    <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium text-slate-400">{client?.name ?? "Client"} · <span className="capitalize">{website.environment}</span></p><h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950">{website.name}</h1><a href={website.primary_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-red-700 hover:underline">{website.primary_url}<ExternalLink size={12} /></a></div><div className="flex flex-wrap items-center gap-2"><Link href={`/websites/${website.id}/report`} className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Monthly report</Link><span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${lifecycleStatus === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}><span className={`h-1.5 w-1.5 rounded-full ${lifecycleStatus === "active" ? "bg-emerald-500" : "bg-slate-400"}`} /> {lifecycleLabel(lifecycleStatus)} website</span></div></div>
    {monitoringPaused && <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">Monitoring and expiry reminders are paused. Existing history is retained and checks resume when the website and its client are Active.</p>}
    {paramsResult.error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{websiteError(paramsResult.error)}</p>}
    {paramsResult.success && <DismissibleNotice className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">{paramsResult.success === "lifecycle" ? "Website status updated; history was retained." : paramsResult.success === "renewed" ? "Renewal recorded and reminder schedule updated." : paramsResult.success === "endpoint_removed" ? "Endpoint and its check history removed." : paramsResult.success === "endpoint" ? "Uptime endpoint added." : "Website information saved."}</DismissibleNotice>}

    {website.platform === "wordpress" && <WordPressSecurityPanel websiteId={website.id} websiteUrl={website.primary_url} canManage={can(context.role, "manage_websites")} stale={isConnectorReportStale(connectorResult.data?.last_report_at ?? null)} evaluatedAt={new Date().toISOString()} connection={connectorResult.data} vulnerability={centralVulnerability} latest={wordpressLatestResult.data as { collected_at: string; wordpress_version: string; plugins: Array<{ slug: string; name: string; version: string; active: boolean; update_status: "available" | "unavailable" | "unknown"; update_version?: string | null }>; spam_comment_count: number; security_report: import("@/lib/wordpress-connector/security-types").ConnectorSecurityReport | import("@/lib/wordpress-connector/security-types").ProposedConnectorSecurityReport | Record<string, never> } | null} />}

    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2"><Activity size={16} className="text-red-600" /><div><h2 className="text-sm font-bold text-slate-900">Website health</h2><p className="mt-0.5 text-[11px] text-slate-400">Live status and recent monitoring history</p></div><span className={`ml-2 rounded-full px-2.5 py-1 text-[10px] font-semibold ${healthWarning ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{healthLabel}</span></div><span className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-medium capitalize text-slate-500">Platform: {website.platform === "nextjs" ? "Next.js" : website.platform === "wordpress" ? "WordPress" : website.platform === "other" ? "Other" : "Not specified"}</span></div>
      <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <HealthMetric label="Uptime · 24 hours" value={uptimePercent === null ? "No data" : `${uptimePercent.toFixed(2)}%`} detail={httpChecks.length ? `${httpChecks.length} checks` : endpoints.length ? "Awaiting checks" : "No endpoints configured"} tone={uptimePercent !== null && uptimePercent < 99 ? "warning" : "normal"} />
        <HealthMetric label="Average response" value={averageResponseMs === null ? "No data" : `${averageResponseMs} ms`} detail={p95ResponseMs === null ? "Last 24 hours" : `95th percentile ${p95ResponseMs} ms`} />
        <HealthMetric label="SSL/TLS certificates" value={certificateTargetCount ? latestCertificateChecks.length === 0 ? "Awaiting check" : latestCertificateChecks.length === certificateTargetCount && latestCertificateChecks.every((check) => check.success) ? "Valid" : latestCertificateChecks.some((check) => !check.success) ? "Attention" : "Partial data" : "Not monitored"} detail={certificateTargetCount ? `${httpsEndpoints.length} HTTPS endpoint(s) · ${certificateAssets.length} certificate asset(s)` : "Add an HTTPS endpoint to monitor SSL/TLS"} tone={latestCertificateChecks.some((check) => !check.success) ? "warning" : "normal"} />
        <HealthMetric label="Performance score" value={typeof performanceMetrics?.performance_score === "number" ? `${performanceMetrics.performance_score}/100` : latestPerformance ? "Scan failed" : "Awaiting scan"} detail={latestPerformance ? `${latestPerformance.error_code ? `${latestPerformance.error_code.replaceAll("_", " ")} · ` : ""}PageSpeed · ${formatCheckedAt(latestPerformance.checked_at, context.timeZone)}` : "Daily Lighthouse scan"} tone={latestPerformance?.success === false || typeof performanceMetrics?.performance_score === "number" && performanceMetrics.performance_score < 50 ? "warning" : "normal"} />
      </div>
      <div className="grid gap-5 border-t border-slate-100 p-5 lg:grid-cols-[1fr_1fr]">
        <div><h3 className="flex items-center gap-2 text-xs font-bold text-slate-800"><Zap size={14} className="text-amber-500" /> Performance · PageSpeed Insights</h3>
          {latestPerformance?.success && performanceMetrics ? <><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["LCP", performanceMetrics.lcp_ms, " ms"], ["INP", performanceMetrics.inp_ms, " ms"], ["CLS", performanceMetrics.cls, ""], ["FCP", performanceMetrics.fcp_ms, " ms"], ["Accessibility", performanceMetrics.accessibility_score, "/100"], ["Best practices", performanceMetrics.best_practices_score, "/100"], ["SEO", performanceMetrics.seo_score, "/100"]].map(([label, value, suffix]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-2.5"><p className="text-[10px] text-slate-400">{label}</p><p className="mt-1 text-xs font-semibold text-slate-700">{typeof value === "number" ? `${value}${suffix}` : label === "INP" ? "No field data" : "—"}</p></div>)}</div><p className="mt-3 text-[10px] text-slate-400">{Number(performanceMetrics.field_data_available) ? "Core Web Vitals use available real-user field data; other timing values are Lighthouse lab measurements." : "No CrUX field data was returned for this site. INP requires real-user field data; CLS uses Lighthouse when available."}</p></> : <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-[11px] text-slate-500">{latestPerformance?.sanitized_error_message ?? "A daily mobile Lighthouse scan will populate performance and Core Web Vitals here."}</p>}
        </div>
        <div><h3 className="text-xs font-bold text-slate-800">Recent history</h3>
          {httpChecks.length ? <div className="mt-3 flex h-16 items-end gap-1">{httpChecks.slice(0, 30).reverse().map((check, index) => <span key={`${check.checked_at}-${index}`} title={`${check.success ? "Healthy" : "Failed"} · ${check.response_time_ms ?? "—"} ms`} className={`min-w-1 flex-1 rounded-t ${check.success ? "bg-emerald-400" : "bg-red-400"}`} style={{ height: `${Math.max(15, Math.min(100, check.response_time_ms ? 100 - Math.min(check.response_time_ms / 50, 70) : 30))}%` }} />)}</div> : <p className="mt-3 text-[11px] text-slate-500">No uptime history in the last 24 hours.</p>}
          <div className="mt-3 space-y-1.5">{latestCertificateChecks.slice(0, 3).map((check) => { const asset = "asset_id" in check && check.asset_id ? certificateAssets.find((item) => item.id === check.asset_id) : null; const endpoint = "endpoint_id" in check && check.endpoint_id ? httpsEndpoints.find((item) => item.id === check.endpoint_id) : null; const label = asset?.service_name ?? asset?.hostname ?? (endpoint ? new URL(endpoint.endpoint_url).hostname : "Certificate"); return <p key={check.id} className="flex items-center justify-between gap-2 text-[10px]"><span className="truncate text-slate-500">TLS · {label}</span><span className={check.success ? "text-emerald-700" : "text-red-700"}>{check.success ? "Valid" : check.sanitized_error_message ?? "Invalid"} · {formatCheckedAt(check.checked_at, context.timeZone)}</span></p>; })}</div>
          {performanceChecks.slice(0, 3).map((check) => { const metadata = check.metadata as Record<string, number | null>; return <p key={check.id} className="mt-1.5 flex items-center justify-between gap-2 text-[10px]"><span className="text-slate-500">Performance scan</span><span className={check.success ? "text-slate-600" : "text-red-700"}>{check.success ? `${metadata.performance_score ?? "—"}/100` : check.sanitized_error_message ?? "Failed"} · {formatCheckedAt(check.checked_at, context.timeZone)}</span></p>; })}
        </div>
      </div>
    </section>

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
                {asset.renewal_url && <a href={asset.renewal_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-red-700 hover:underline">Renew service <ExternalLink size={11} /></a>}
              </div>
              {(can(context.role, "confirm_renewals") || can(context.role, "manage_assets")) && <details className="ml-12 mt-3"><summary className="cursor-pointer text-[10px] font-semibold text-red-700">Confirm renewal</summary><form action={confirmRenewal} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="websiteId" value={website.id} /><div><label htmlFor={`expiry-${asset.id}`} className="mb-1 block text-[10px] font-medium text-slate-500">New verified expiry</label><input id={`expiry-${asset.id}`} name="newExpiryDate" type="date" required className="h-8 rounded-md border border-slate-200 px-2 text-[11px]" /></div><div className="min-w-0 flex-1"><label htmlFor={`notes-${asset.id}`} className="mb-1 block text-[10px] font-medium text-slate-500">Confirmation notes</label><input id={`notes-${asset.id}`} name="notes" maxLength={1000} className="h-8 w-full rounded-md border border-slate-200 px-2 text-[11px]" placeholder="Optional" /></div><button type="submit" className="h-8 rounded-md bg-red-600 px-3 text-[11px] font-semibold text-white hover:bg-red-700">Record</button></form></details>}
              {can(context.role, "manage_assets") && <form action={archiveAsset} className="ml-12 mt-2"><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="websiteId" value={website.id} /><ConfirmSubmit type="submit" confirmation={`Archive ${display}? Monitoring records and renewal history will be retained.`} className="text-[10px] font-semibold text-red-600 hover:underline">Archive asset</ConfirmSubmit></form>}
            </div>;
          })}</div> : <p className="px-5 py-8 text-xs text-slate-400">No infrastructure assets have been added.</p>}
          {can(context.role, "manage_assets") && <details className="border-t border-slate-100 px-5 py-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-red-700"><Plus size={14} /> Add service asset</summary><form action={createAsset} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="websiteId" value={website.id} /><AssetFields /><button type="submit" className="h-9 rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 sm:col-span-2">Save service</button></form></details>}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Uptime endpoints</h2><p className="mt-0.5 text-[11px] text-slate-400">HTTP and HTTPS certificate checks run on the monitoring schedule.</p></div><Globe2 size={16} className="text-slate-400" /></div>
          {endpoints.length ? <div className="divide-y divide-slate-100">{endpoints.map((endpoint) => {
            const latestCheck = latestEndpointChecks.get(endpoint.id);
            const networkUncertain = latestCheck && !latestCheck.success && uncertainTransportErrors.includes(latestCheck.error_code ?? "");
            const down = endpoint.consecutive_failures >= endpoint.consecutive_failure_threshold;
            const latestFailed = latestCheck ? !latestCheck.success && !networkUncertain : down;
            const duplicateEndpoint = endpoint.enabled && endpoints.some((other) => other.id !== endpoint.id && other.enabled && other.endpoint_url.replace(/\/$/, "") === endpoint.endpoint_url.replace(/\/$/, ""));
            return <div key={endpoint.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5"><span className={`h-2 w-2 rounded-full ${!endpoint.enabled ? "bg-slate-300" : networkUncertain ? "bg-amber-400" : latestFailed ? "bg-red-500" : latestCheck?.success || endpoint.last_success_at ? "bg-emerald-500" : "bg-amber-400"}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{endpoint.endpoint_url}</p><p className="mt-1 text-[10px] text-slate-400">{!endpoint.enabled ? "Disabled" : networkUncertain ? `Status unconfirmed · ${latestCheck?.error_code === "timeout" ? "check timed out" : "monitor network failure"}` : latestFailed ? `${down ? `Down · ${endpoint.consecutive_failures} consecutive failures` : "Latest check failed"}${latestCheck?.http_status ? ` · HTTP ${latestCheck.http_status}` : latestCheck?.error_code ? ` · ${latestCheck.error_code}` : ""}` : latestCheck?.success || endpoint.last_success_at ? `Healthy · checked ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone }).format(new Date(endpoint.last_checked_at ?? endpoint.last_success_at!))}` : "Awaiting first check"} · every {Math.round(endpoint.check_interval_seconds / 60)} min{duplicateEndpoint ? " · duplicate URL; consider keeping one enabled endpoint" : ""}</p></div>
              {can(context.role, "manage_monitoring") && <div className="flex items-center gap-2"><form action={setMonitoringEndpoint}><input type="hidden" name="endpointId" value={endpoint.id} /><input type="hidden" name="websiteId" value={website.id} /><input type="hidden" name="enabled" value={String(!endpoint.enabled)} /><button type="submit" className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">{endpoint.enabled ? "Disable" : "Enable"}</button></form><form action={removeMonitoringEndpoint}><input type="hidden" name="endpointId" value={endpoint.id} /><input type="hidden" name="websiteId" value={website.id} /><ConfirmSubmit type="submit" confirmation={`Remove ${endpoint.endpoint_url}? Its stored endpoint check history will also be permanently deleted.`} className="rounded-md border border-red-200 px-2.5 py-1.5 text-[10px] font-semibold text-red-700 hover:bg-red-50">Remove</ConfirmSubmit></form></div>}
            </div>;
          })}</div> : <p className="px-5 py-8 text-xs text-slate-400">No uptime checks are configured.</p>}
          {can(context.role, "manage_monitoring") && <details className="border-t border-slate-100 px-5 py-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-red-700"><Plus size={14} /> Add uptime endpoint</summary><form action={createMonitoringEndpoint} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="websiteId" value={website.id} /><div className="sm:col-span-2"><label htmlFor="endpointUrl" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Public HTTP(S) URL</label><input id="endpointUrl" name="endpointUrl" type="url" required maxLength={2048} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-red-500" placeholder="https://example.com/health" /></div><div><label htmlFor="checkInterval" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Interval (seconds)</label><input id="checkInterval" name="checkInterval" type="number" min={60} max={86400} defaultValue={300} required className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" /></div><div><label htmlFor="timeout" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Timeout (seconds)</label><input id="timeout" name="timeout" type="number" min={1} max={60} defaultValue={15} required className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" /></div><button type="submit" className="h-9 rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 sm:col-span-2">Create endpoint</button></form></details>}
        </section>
      </div>

      <div className="space-y-5">
        {can(context.role, "manage_websites") && <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-sm font-bold text-slate-900">Website settings</h2><form action={updateWebsite} className="mt-4 space-y-3"><input type="hidden" name="websiteId" value={website.id} /><WebsiteFields clients={clientsResult.data ?? []} website={{ name: website.name, primary_url: website.primary_url, environment: website.environment, platform: website.platform, client_id: website.client_id }} /><button type="submit" className="h-9 w-full rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700">Save website</button></form><LifecycleStatusForm action={updateWebsiteLifecycle} entityField="websiteId" entityId={website.id} status={website.lifecycle_status as LifecycleStatus} /></section>}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-bold text-slate-900">Open incidents</h2></div>
          {incidentsResult.data?.length ? <div className="divide-y divide-slate-100">{incidentsResult.data.map((incident) => <div key={incident.id} className="px-5 py-3.5"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{incident.summary}</p><span className="text-[10px] capitalize text-amber-700">{incident.severity}</span></div><p className="mt-1 text-[10px] capitalize text-slate-400">{incident.incident_type.replaceAll("_", " ")} · {incident.status} · started {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: context.timeZone }).format(new Date(incident.started_at))}</p></div>)}</div> : <p className="px-5 py-7 text-xs text-slate-400">No open incidents.</p>}
          <div className="border-t border-slate-100 px-5 py-3"><Link href="/incidents" className="text-xs font-semibold text-red-700 hover:underline">View incident timeline</Link></div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <details>
            <summary className="group flex cursor-pointer list-none items-center gap-2 px-5 py-4"><CalendarClock size={15} className="text-slate-400" /><span className="text-sm font-bold text-slate-900">Recent check results</span><span className="text-[10px] text-slate-400">{historyResult.data?.length ?? 0} results</span><ChevronDown size={14} className="ml-auto text-slate-400 transition-transform group-open:rotate-180" /></summary>
            {historyResult.data?.length ? <div className="divide-y divide-slate-100 border-t border-slate-100">{historyResult.data.map((check, index) => { const uncertain = !check.success && uncertainTransportErrors.includes(check.error_code ?? ""); return <div key={`${check.endpoint_id}-${check.checked_at}-${index}`} className="flex items-center gap-2 px-5 py-3"><span className={`h-2 w-2 rounded-full ${check.success ? "bg-emerald-500" : uncertain ? "bg-amber-400" : "bg-red-500"}`} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-slate-700">{uncertain ? `Status unconfirmed · ${check.error_code === "timeout" ? "monitor check timed out" : "monitor network failure"}` : check.success ? `HTTP ${check.http_status ?? "OK"}` : check.http_status ? `HTTP ${check.http_status} · ${check.sanitized_error_message ?? "Unexpected response"}` : `${check.sanitized_error_message ?? "Request failed"}${check.error_code ? ` · ${check.error_code}` : ""}`}</p><p className="mt-0.5 text-[10px] text-slate-400">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone }).format(new Date(check.checked_at))}</p></div><span className="text-[10px] text-slate-500">{check.response_time_ms === null ? "—" : `${check.response_time_ms} ms`}</span></div>; })}</div> : <p className="border-t border-slate-100 px-5 py-7 text-xs text-slate-400">No completed checks to show yet.</p>}
          </details>
        </section>
      </div>
    </div>
  </div></main>;
}

function websiteError(error: string): string {
  if (error === "invalid") return "Check the website details and choose an active client when creating a website.";
  if (error === "asset") return "The service asset was not saved. Check the type, hostname, expiry date, and renewal URL.";
  if (error === "endpoint") return "The endpoint was not saved. Use a public HTTP(S) URL on port 80 or 443 and valid check settings.";
  if (error === "endpoint_remove") return "The endpoint could not be removed.";
  if (error === "lifecycle") return "The website status could not be updated.";
  return "Website or renewal changes could not be saved.";
}

function HealthMetric({ label, value, detail, tone = "normal" }: { label: string; value: string; detail: string; tone?: "normal" | "warning" }) {
  return <div className="px-5 py-4"><p className="text-[10px] font-medium text-slate-400">{label}</p><p className={`mt-1 text-lg font-bold tracking-tight ${tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>{value}</p><p className="mt-1 text-[10px] text-slate-400">{detail}</p></div>;
}

function formatCheckedAt(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}

function getSince24Hours(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function WebsiteLoading() {
  return <main className="min-h-screen bg-white p-8"><div className="mx-auto h-[700px] max-w-6xl animate-pulse rounded-xl bg-white" /></main>;
}
