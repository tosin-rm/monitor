import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { can } from "@/lib/auth/roles";
import { sendMonthlyReport } from "@/app/websites/[websiteId]/report/actions";
import { PrintReportButton } from "@/app/websites/[websiteId]/report/print-button";
import { getRequestAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildReportSummary } from "@/lib/reports/summary";

export const metadata: Metadata = { title: "Monthly website report" };

type CheckRow = {
  id: string;
  checked_at: string;
  success: boolean;
  response_time_ms: number | null;
  certificate_not_after?: string | null;
  sanitized_error_message?: string | null;
  asset_id?: string | null;
  endpoint_id?: string | null;
  metadata: Record<string, unknown> | null;
};

export default async function WebsiteReportPage(props: {
  params: Promise<{ websiteId: string }>;
  searchParams: Promise<{ month?: string; summary?: string; emailSent?: string; emailError?: string }>;
}) {
  return <Suspense fallback={<main className="min-h-screen bg-slate-50 px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto h-96 max-w-5xl animate-pulse rounded-xl bg-white" /></main>}><WebsiteReportContent params={props.params} searchParams={props.searchParams} /></Suspense>;
}

async function WebsiteReportContent(props: {
  params: Promise<{ websiteId: string }>;
  searchParams: Promise<{ month?: string; summary?: string; emailSent?: string; emailError?: string }>;
}) {
  const context = await getRequestAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const [{ websiteId }, params] = await Promise.all([props.params, props.searchParams]);
  const defaultMonth = previousMonth(new Date(), context.timeZone);
  const selectedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "") ? params.month! : defaultMonth;
  const includeSummary = params.summary === "1";
  const [year, month] = selectedMonth.split("-").map(Number) as [number, number];
  const periodStart = zonedDateToUtc(year, month - 1, 1, context.timeZone);
  const periodEnd = zonedDateToUtc(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, context.timeZone);
  const supabase = await createClient();

  const [websiteResult, endpointResult, assetResult, incidentsResult] = await Promise.all([
    supabase.from("websites").select("id, name, primary_url, platform, client_id, client:clients(name, contact_email)").eq("id", websiteId).eq("organization_id", context.organizationId).eq("active", true).maybeSingle(),
    supabase.from("monitoring_endpoints").select("id, endpoint_url").eq("website_id", websiteId).eq("organization_id", context.organizationId),
    supabase.from("assets").select("id, asset_type, service_name, hostname, expiry_date, renewal_status").eq("website_id", websiteId).eq("organization_id", context.organizationId),
    supabase.from("incidents").select("id, incident_type, severity, status, started_at, last_observed_at, resolved_at, occurrence_count, summary")
      .eq("website_id", websiteId).eq("organization_id", context.organizationId)
      .lt("started_at", periodEnd.toISOString()).or(`resolved_at.is.null,resolved_at.gte.${periodStart.toISOString()}`)
      .order("started_at", { ascending: true }).limit(500),
  ]);
  if (websiteResult.error || endpointResult.error || assetResult.error || incidentsResult.error) {
    console.error("Monthly website report query failed", [websiteResult.error, endpointResult.error, assetResult.error, incidentsResult.error].filter(Boolean).map((error) => error?.code));
    throw new Error("The monthly website report could not be loaded.");
  }
  if (!websiteResult.data) notFound();
  const website = websiteResult.data;
  const client = Array.isArray(website.client) ? website.client[0] : website.client;
  const endpointIds = (endpointResult.data ?? []).map((endpoint) => endpoint.id);
  const assets = assetResult.data ?? [];
  const sslAssets = assets.filter((asset) => asset.asset_type === "ssl_certificate");
  const assetIds = assets.map((asset) => asset.id);
  const [httpChecks, performanceChecks, sslChecks, renewalResult] = await Promise.all([
    endpointIds.length ? loadChecks(supabase, context.organizationId, periodStart, periodEnd, "http", "endpoint_id", endpointIds) : Promise.resolve([]),
    loadChecks(supabase, context.organizationId, periodStart, periodEnd, "performance", "website_id", [websiteId]),
    sslAssets.length ? loadChecks(supabase, context.organizationId, periodStart, periodEnd, "ssl", "asset_id", sslAssets.map((asset) => asset.id)) : Promise.resolve([]),
    assetIds.length ? supabase.from("renewal_history").select("id, asset_id, previous_expiry_date, new_expiry_date, confirmation_method, confirmation_notes, created_at")
      .eq("organization_id", context.organizationId).in("asset_id", assetIds)
      .gte("created_at", periodStart.toISOString()).lt("created_at", periodEnd.toISOString())
      .order("created_at", { ascending: true }).limit(500) : Promise.resolve({ data: [], error: null }),
  ]);
  if (renewalResult.error) {
    console.error("Monthly report renewal history query failed", { code: renewalResult.error.code });
    throw new Error("Maintenance history could not be loaded.");
  }
  const wordpressReportResult = website.platform === "wordpress"
    ? await supabase.from("wordpress_connector_reports").select("collected_at, plugins, spam_comment_count", { count: "exact" })
      .eq("website_id", websiteId).eq("organization_id", context.organizationId)
      .gte("received_at", periodStart.toISOString()).lt("received_at", periodEnd.toISOString())
      .order("received_at", { ascending: false }).limit(250)
    : { data: [], count: 0, error: null };
  if (wordpressReportResult.error) {
    console.error("Monthly report WordPress security query failed", { code: wordpressReportResult.error.code });
    throw new Error("WordPress security history could not be loaded.");
  }
  type ReportPlugin = { slug: string; name: string; version: string; active: boolean; update_status: "available" | "unavailable" | "unknown"; update_version?: string | null };
  const latestWordPressReport = wordpressReportResult.data?.[0] as { collected_at: string; plugins: ReportPlugin[]; spam_comment_count: number } | undefined;
  const wpUpdateCount = latestWordPressReport?.plugins.filter((plugin) => plugin.update_status === "available").length ?? 0;
  const wpUnknownUpdateCount = latestWordPressReport?.plugins.filter((plugin) => plugin.update_status === "unknown").length ?? 0;
  const sortedResponseTimes = httpChecks.map((check) => check.response_time_ms).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const uptime = httpChecks.length ? httpChecks.filter((check) => check.success).length / httpChecks.length * 100 : null;
  const averageResponse = sortedResponseTimes.length ? Math.round(sortedResponseTimes.reduce((total, value) => total + value, 0) / sortedResponseTimes.length) : null;
  const p95Response = sortedResponseTimes.length ? sortedResponseTimes[Math.min(sortedResponseTimes.length - 1, Math.ceil(sortedResponseTimes.length * 0.95) - 1)] : null;
  const currentCertificates = new Map<string, CheckRow>();
  for (const check of [...sslChecks].sort((a, b) => b.checked_at.localeCompare(a.checked_at))) {
    if (check.asset_id && !currentCertificates.has(check.asset_id)) currentCertificates.set(check.asset_id, check);
  }
  const incidents = incidentsResult.data ?? [];
  const renewals = renewalResult.data ?? [];
  const successfulSsl = sslChecks.filter((check) => check.success).length;
  const failedSsl = sslChecks.length - successfulSsl;
  const reportSummary = includeSummary ? buildReportSummary({
    uptimePercent: uptime,
    uptimeChecks: httpChecks.length,
    averageResponseMs: averageResponse,
    p95ResponseMs: p95Response,
    incidents,
    sslChecks: sslChecks.length,
    sslPassed: successfulSsl,
    performanceScores: [...performanceChecks].reverse().map((check) => typeof check.metadata?.performance_score === "number" ? check.metadata.performance_score : null),
    wordpress: website.platform === "wordpress" ? { reportCount: wordpressReportResult.count ?? 0, updateCount: wpUpdateCount, updateUnknownCount: wpUnknownUpdateCount, spamCount: latestWordPressReport?.spam_comment_count ?? 0 } : null,
  }) : null;
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
  const generatedAt = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: context.timeZone }).format(new Date());

  return <main className="min-h-screen bg-slate-50 px-5 py-7 sm:px-8 sm:py-9 print:min-h-0 print:bg-white print:p-0"><div className="mx-auto max-w-5xl">
    <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3"><Link href={`/websites/${websiteId}`} className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Website dashboard</Link><PrintReportButton /></div>
    <form method="get" className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"><div><label htmlFor="report-month" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Reporting month</label><input id="report-month" type="month" name="month" value={selectedMonth} required className="h-10 rounded-lg border border-slate-200 px-3 text-xs" /></div><label className="flex h-10 items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="summary" value="1" defaultChecked={includeSummary} className="accent-red-600" /> Include plain-language summary</label><button type="submit" className="h-10 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">Preview report</button></form>
    {params.emailSent === "1" && <p role="status" className="no-print mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">The mail provider accepted the report email. This confirms submission, not delivery.</p>}
    {params.emailError && <p role="alert" className="no-print mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{reportEmailError(params.emailError)}</p>}
    {can(context.role, "manage_websites") && <section className="no-print mb-5 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-sm font-bold text-slate-900">Send this report by email</h2><p className="mt-1 text-[11px] text-slate-500">Review the recipients, subject, and message. The report will be regenerated for {monthLabel} and attached as a PDF.</p><form action={sendMonthlyReport} className="mt-4 grid gap-3"><input type="hidden" name="websiteId" value={websiteId} /><input type="hidden" name="month" value={selectedMonth} /><label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="includeSummary" value="1" defaultChecked={includeSummary} className="accent-red-600" /> Include the plain-language summary in the attached PDF</label><div><label htmlFor="report-recipients" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Recipients</label><textarea id="report-recipients" name="recipients" defaultValue={client?.contact_email ?? ""} required maxLength={6000} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-red-500" placeholder="client@example.com, manager@example.com" /><p className="mt-1 text-[10px] text-slate-400">Enter addresses separated by commas, semicolons, or new lines. Additional recipients are blind-copied.</p></div><div><label htmlFor="report-subject" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Subject</label><input id="report-subject" name="subject" required maxLength={200} defaultValue={`Monthly website maintenance report · ${monthLabel} · ${website.name}`} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-red-500" /></div><div><label htmlFor="report-message" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Message</label><textarea id="report-message" name="message" required maxLength={4000} rows={4} defaultValue={`Hi ${client?.name ?? "there"},\n\nPlease find attached the monthly website maintenance report for ${monthLabel}.\n\nKind regards`} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs leading-5 outline-none focus:border-red-500" /></div><button type="submit" className="h-10 w-fit rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700">Send report</button></form></section>}

    <article className="report-paper rounded-xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-6"><div><div className="flex items-center gap-2 text-red-700"><FileText size={17} /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">Monitor · Website Care</span></div><h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">Monthly Website Maintenance Report</h1><p className="mt-2 text-sm text-slate-500">{monthLabel}</p></div><div className="text-right text-xs leading-5 text-slate-500"><p className="font-semibold text-slate-800">{client?.name ?? "Client"}</p><p>{website.name}</p><p className="break-all">{website.primary_url}</p><p className="capitalize">{website.platform === "nextjs" ? "Next.js" : website.platform === "wordpress" ? "WordPress" : website.platform === "other" ? "Other" : "Platform not specified"}</p></div></header>

      <section className="mt-6"><h2 className="text-sm font-bold text-slate-900">Service summary</h2><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{[
        ["Uptime", uptime === null ? "No data" : `${uptime.toFixed(2)}%`, `${httpChecks.length} checks`],
        ["Avg response", averageResponse === null ? "No data" : `${averageResponse} ms`, p95Response === null ? "No response-time data" : `P95 ${p95Response} ms`],
        ["Incidents", String(incidents.length), "overlapping report period"],
        ["TLS checks", sslChecks.length ? `${successfulSsl} passed` : "No data", failedSsl ? `${failedSsl} failed` : `${sslAssets.length} certificate assets`],
      ].map(([label, value, detail]) => <div key={label} className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] font-medium text-slate-400">{label}</p><p className="mt-1 text-lg font-bold text-slate-900">{value}</p><p className="mt-1 text-[10px] text-slate-500">{detail}</p></div>)}</div></section>

      {reportSummary && <section className="mt-7"><h2 className="text-sm font-bold text-slate-900">Plain-language summary</h2><p className="mt-1 text-[10px] text-slate-400">Generated from recorded measurements for {monthLabel}; it does not fill in missing checks.</p><ul className="mt-3 list-disc space-y-1.5 rounded-lg bg-slate-50 p-4 pl-8 text-xs leading-5 text-slate-700">{reportSummary.overview.map((line, index) => <li key={`overview-${index}`}>{line}</li>)}</ul><h3 className="mt-4 text-xs font-bold text-slate-800">Recommended follow-ups</h3><ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-5 text-slate-700">{reportSummary.followUps.map((line, index) => <li key={`followup-${index}`}>{line}</li>)}</ul><p className="mt-2 text-[10px] leading-4 text-slate-400">This is a rule-based summary, not an AI assessment. Measurements and check coverage are shown in the sections below.</p></section>}

      {website.platform === "wordpress" && <section className="mt-7">
        <h2 className="text-sm font-bold text-slate-900">WordPress security snapshot</h2>
        {latestWordPressReport ? <>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] text-slate-400">Plugin updates</p><p className="mt-1 text-lg font-bold text-slate-900">{wpUpdateCount} available</p><p className="text-[10px] text-slate-500">{wpUnknownUpdateCount} status unknown · Latest inventory: {formatDate(latestWordPressReport.collected_at, context.timeZone)}</p>{wpUpdateCount > 0 && <a href={wordpressAdminLink(website.primary_url, "plugins.php")} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[10px] font-semibold text-red-700 hover:underline">Review in WordPress admin ↗</a>}</div>
            <div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] text-slate-400">Spam comments</p><p className="mt-1 text-lg font-bold text-slate-900">{latestWordPressReport.spam_comment_count}</p><p className="text-[10px] text-slate-500">Latest count-only inventory</p>{latestWordPressReport.spam_comment_count > 0 && <a href={wordpressAdminLink(website.primary_url, "edit-comments.php?comment_status=spam")} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[10px] font-semibold text-red-700 hover:underline">Review spam queue ↗</a>}</div>
            <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3"><p className="text-[10px] text-slate-500">Vulnerabilities and suspicious activity</p><p className="mt-1 text-xs font-bold text-amber-800">Not checked</p><p className="mt-1 text-[10px] leading-4 text-slate-500">The connector reports inventory and update availability only. No security scanner findings were received.</p></div>
          </div>
          {wpUpdateCount > 0 && <div className="mt-3 rounded-lg border border-slate-200"><p className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold text-slate-600">Plugins with updates available in latest inventory</p><ul className="divide-y divide-slate-100">{latestWordPressReport.plugins.filter((plugin) => plugin.update_status === "available").map((plugin) => <li key={plugin.slug} className="flex items-center justify-between gap-3 px-3 py-2 text-[10px]"><span><strong className="text-slate-700">{plugin.name}</strong><span className="text-slate-400"> · v{plugin.version}{plugin.update_version ? ` → v${plugin.update_version}` : ""}</span></span><a href={wordpressAdminLink(website.primary_url, "plugins.php")} target="_blank" rel="noopener noreferrer" className="shrink-0 font-semibold text-red-700 hover:underline">Review plugin ↗</a></li>)}</ul></div>}
        </> : <p className="mt-3 text-xs text-slate-500">No WordPress inventory report was received during this period. Plugin updates, spam counts, vulnerabilities, and suspicious activity are unknown.</p>}
      </section>}

      <section className="mt-7"><h2 className="text-sm font-bold text-slate-900">Performance trend</h2>{performanceChecks.length ? <div className="mt-3 overflow-hidden rounded-lg border border-slate-200"><table className="w-full border-collapse text-left text-[10px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-2.5 font-semibold">Date</th><th className="p-2.5 font-semibold">Mobile score</th><th className="p-2.5 font-semibold">LCP</th><th className="p-2.5 font-semibold">INP</th><th className="p-2.5 font-semibold">CLS</th></tr></thead><tbody>{performanceChecks.map((check) => { const metrics = check.metadata ?? {}; return <tr key={check.id} className="border-t border-slate-100"><td className="p-2.5">{formatDate(check.checked_at, context.timeZone)}</td><td className="p-2.5">{numberOrDash(metrics.performance_score, "/100")}</td><td className="p-2.5">{numberOrDash(metrics.lcp_ms, " ms")}</td><td className="p-2.5">{numberOrDash(metrics.inp_ms, " ms")}</td><td className="p-2.5">{numberOrDash(metrics.cls, "")}</td></tr>; })}</tbody></table></div> : <p className="mt-3 text-xs text-slate-500">No performance scans were recorded during this period.</p>}<p className="mt-2 text-[10px] leading-4 text-slate-400">Performance score and fallback timings are Lighthouse mobile lab measurements. LCP, INP, and CLS are field data when a real-user sample is available; otherwise the report shows a dash.</p></section>

      <section className="mt-7"><h2 className="text-sm font-bold text-slate-900">TLS and certificate status</h2>{sslAssets.length ? <div className="mt-3 overflow-hidden rounded-lg border border-slate-200"><table className="w-full border-collapse text-left text-[10px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-2.5 font-semibold">Certificate</th><th className="p-2.5 font-semibold">Latest status in period</th><th className="p-2.5 font-semibold">Expires</th><th className="p-2.5 font-semibold">Checks this period</th></tr></thead><tbody>{sslAssets.map((asset) => { const latest = currentCertificates.get(asset.id); const count = sslChecks.filter((check) => check.asset_id === asset.id).length; return <tr key={asset.id} className="border-t border-slate-100"><td className="p-2.5">{asset.service_name ?? asset.hostname ?? "Certificate"}</td><td className={`p-2.5 font-semibold ${latest?.success ? "text-emerald-700" : latest ? "text-red-700" : "text-slate-500"}`}>{latest ? latest.success ? "Valid at last check" : latest.sanitized_error_message ?? "Invalid at last check" : "No check in period"}</td><td className="p-2.5">{asset.expiry_date ?? "Unknown"}</td><td className="p-2.5">{count}</td></tr>; })}</tbody></table></div> : <p className="mt-3 text-xs text-slate-500">No SSL certificate assets are configured for this website.</p>}</section>

      <section className="mt-7"><h2 className="text-sm font-bold text-slate-900">Incidents</h2>{incidents.length ? <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">{incidents.map((incident) => <div key={incident.id} className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{incident.summary}</p><span className="text-[10px] capitalize text-slate-500">{incident.severity} · {incident.status}</span></div><p className="mt-1 text-[10px] text-slate-500">{incident.incident_type.replaceAll("_", " ")} · Started {formatDate(incident.started_at, context.timeZone)} · {incident.occurrence_count} observation(s){incident.resolved_at ? ` · Resolved ${formatDate(incident.resolved_at, context.timeZone)}` : " · Still open at report time"}</p></div>)}</div> : <p className="mt-3 text-xs text-slate-500">No incidents overlapped this reporting period.</p>}</section>

      <section className="mt-7"><h2 className="text-sm font-bold text-slate-900">Recorded maintenance activity</h2>{renewals.length ? <ul className="mt-3 space-y-2">{renewals.map((renewal) => { const asset = assets.find((item) => item.id === renewal.asset_id); return <li key={renewal.id} className="rounded-lg border border-slate-200 p-3 text-xs"><p className="font-semibold text-slate-800">{asset?.service_name ?? asset?.hostname ?? "Service"} renewal confirmed</p><p className="mt-1 text-[10px] text-slate-500">{formatDate(renewal.created_at, context.timeZone)} · {renewal.previous_expiry_date ?? "Unknown"} → {renewal.new_expiry_date ?? "Unknown"} · {renewal.confirmation_method.replaceAll("_", " ")}</p>{renewal.confirmation_notes && <p className="mt-1 text-[10px] text-slate-500">{renewal.confirmation_notes}</p>}</li>; })}</ul> : <p className="mt-3 text-xs text-slate-500">No renewal actions were recorded during this period. Other maintenance work is not currently logged in Monitor.</p>}</section>

      <footer className="mt-9 border-t border-slate-200 pt-4 text-[10px] leading-5 text-slate-400"><p>Report generated {generatedAt} · Times shown in {context.timeZone}.</p><p>Monitoring coverage depends on configured endpoints, certificate assets, worker schedules, and retained check history.</p></footer>
    </article>
  </div></main>;
}

async function loadChecks(
  client: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  start: Date,
  end: Date,
  checkType: "http" | "performance" | "ssl",
  target: "endpoint_id" | "website_id" | "asset_id",
  ids: string[],
): Promise<CheckRow[]> {
  const checks: CheckRow[] = [];
  const batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const query = client.from("check_results").select("id, checked_at, success, response_time_ms, certificate_not_after, sanitized_error_message, asset_id, endpoint_id, metadata")
      .eq("organization_id", organizationId).eq("check_type", checkType)
      .gte("checked_at", start.toISOString()).lt("checked_at", end.toISOString())
      .in(target, ids).order("checked_at", { ascending: false }).range(offset, offset + batchSize - 1);
    const { data, error } = await query;
    if (error) {
      console.error("Monthly report check history query failed", { checkType, code: error.code });
      throw new Error("Monitoring history could not be loaded.");
    }
    const page = (data ?? []) as CheckRow[];
    checks.push(...page);
    if (page.length < batchSize) break;
  }
  return checks;
}

function previousMonth(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function zonedDateToUtc(year: number, monthIndex: number, day: number, timeZone: string): Date {
  const target = Date.UTC(year, monthIndex, day);
  const estimate = new Date(target);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(estimate);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const observedAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(target + (target - observedAsUtc));
}

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}

function wordpressAdminLink(siteUrl: string, path: string): string {
  const base = new URL(siteUrl);
  base.search = "";
  base.hash = "";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/wp-admin/`;
  return new URL(path, base).toString();
}

function numberOrDash(value: unknown, suffix: string): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Number(value.toFixed(2))}${suffix}` : "—";
}

function reportEmailError(error: string): string {
  if (error === "forbidden") return "Your role cannot send client reports.";
  if (error === "invalid") return "Check the recipient addresses, subject, and message.";
  if (error === "not_configured") return "Email sending is not configured. Set the Resend API key and sender address.";
  if (error === "report") return "The report data could not be loaded, so no email was sent.";
  return "The mail provider did not accept the report email. Please review the details and try again.";
}
