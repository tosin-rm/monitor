"use server";

import { Resend } from "resend";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/auth/roles";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createPdf, type PdfLine } from "@/lib/reports/pdf";
import { buildReportSummary } from "@/lib/reports/summary";

const recipientsSchema = z.array(z.string().email().max(254)).min(1).max(20);

type CheckRecord = {
  id: string;
  checked_at: string;
  success: boolean;
  http_status: number | null;
  error_code: string | null;
  response_time_ms: number | null;
  sanitized_error_message: string | null;
  asset_id: string | null;
  endpoint_id: string | null;
  metadata: Record<string, unknown> | null;
};

export async function sendMonthlyReport(formData: FormData): Promise<void> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const month = String(formData.get("month") ?? "");
  const includeSummary = String(formData.get("includeSummary") ?? "") === "1";
  const reportPath = `/websites/${websiteId}/report?month=${encodeURIComponent(month)}`;
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_websites")) redirect(`${reportPath}&emailError=forbidden`);
  if (!z.string().uuid().safeParse(websiteId).success || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    redirect("/websites?error=invalid");
  }

  const recipients = String(formData.get("recipients") ?? "")
    .split(/[\n,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const parsedRecipients = recipientsSchema.safeParse([...new Set(recipients)]);
  const subject = String(formData.get("subject") ?? "").replace(/[\r\n\t ]+/g, " ").trim();
  const message = String(formData.get("message") ?? "").trim();
  if (!parsedRecipients.success || subject.length < 1 || subject.length > 200 || message.length < 1 || message.length > 4000) {
    redirect(`${reportPath}&emailError=invalid`);
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) redirect(`${reportPath}&emailError=not_configured`);

  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const start = zonedDateToUtc(year, monthNumber - 1, 1, context.timeZone);
  const end = zonedDateToUtc(monthNumber === 12 ? year + 1 : year, monthNumber === 12 ? 0 : monthNumber, 1, context.timeZone);
  const supabase = await createClient();
  const [websiteResult, endpointResult, assetResult, incidentResult] = await Promise.all([
    supabase.from("websites").select("id, name, primary_url, platform, client:clients(name)").eq("id", websiteId).eq("organization_id", context.organizationId).eq("active", true).maybeSingle(),
    supabase.from("monitoring_endpoints").select("id, endpoint_url").eq("website_id", websiteId).eq("organization_id", context.organizationId),
    supabase.from("assets").select("id, asset_type, service_name, hostname, expiry_date").eq("website_id", websiteId).eq("organization_id", context.organizationId),
    supabase.from("incidents").select("incident_type, severity, status, started_at, resolved_at, occurrence_count, summary")
      .eq("website_id", websiteId).eq("organization_id", context.organizationId).lt("started_at", end.toISOString())
      .or(`resolved_at.is.null,resolved_at.gte.${start.toISOString()}`).order("started_at", { ascending: true }).limit(500),
  ]);
  if (websiteResult.error || endpointResult.error || assetResult.error || incidentResult.error || !websiteResult.data) {
    console.error("Monthly report email data query failed", { code: websiteResult.error?.code ?? endpointResult.error?.code ?? assetResult.error?.code ?? incidentResult.error?.code ?? "not_found" });
    redirect(`${reportPath}&emailError=report`);
  }
  const website = websiteResult.data;
  const clientRelation = Array.isArray(website.client) ? website.client[0] : website.client;
  const clientName = clientRelation?.name ?? "Client";
  const endpoints = endpointResult.data ?? [];
  const assets = assetResult.data ?? [];
  const sslAssets = assets.filter((asset) => asset.asset_type === "ssl_certificate");
  const reportData = await Promise.all([
    endpoints.length ? loadChecks(supabase, context.organizationId, start, end, "http", "endpoint_id", endpoints.map((endpoint) => endpoint.id)) : Promise.resolve([]),
    loadChecks(supabase, context.organizationId, start, end, "performance", "website_id", [websiteId]),
    sslAssets.length ? loadChecks(supabase, context.organizationId, start, end, "ssl", "asset_id", sslAssets.map((asset) => asset.id)) : Promise.resolve([]),
    assets.length ? supabase.from("renewal_history").select("asset_id, previous_expiry_date, new_expiry_date, confirmation_method, confirmation_notes, created_at")
      .eq("organization_id", context.organizationId).in("asset_id", assets.map((asset) => asset.id))
      .gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at", { ascending: true }).limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]).catch((error: unknown) => {
    console.error("Monthly report email metrics query failed", { code: error && typeof error === "object" && "code" in error ? error.code : "query_error" });
    return null;
  });
  if (!reportData) redirect(`${reportPath}&emailError=report`);
  const [httpChecks, performanceChecks, sslChecks, renewalsResult] = reportData;
  if (renewalsResult.error) {
    console.error("Monthly report email maintenance query failed", { code: renewalsResult.error.code });
    redirect(`${reportPath}&emailError=report`);
  }

  const wordpressReportResult = website.platform === "wordpress"
    ? await supabase.from("wordpress_connector_reports").select("collected_at, plugins, spam_comment_count", { count: "exact" })
      .eq("website_id", websiteId).eq("organization_id", context.organizationId)
      .gte("received_at", start.toISOString()).lt("received_at", end.toISOString())
      .order("received_at", { ascending: false }).limit(250)
    : { data: [], count: 0, error: null };
  if (wordpressReportResult.error) {
    console.error("Monthly report email WordPress security query failed", { code: wordpressReportResult.error.code });
    redirect(`${reportPath}&emailError=report`);
  }

  const confirmedHttpChecks = httpChecks.filter((check) => check.error_code !== "network_failure");
  const uncertainChecks = httpChecks.filter((check) => check.error_code === "network_failure");
  const times = confirmedHttpChecks.map((check) => check.response_time_ms).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const uptime = confirmedHttpChecks.length ? confirmedHttpChecks.filter((check) => check.success).length / confirmedHttpChecks.length * 100 : null;
  const average = times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null;
  const p95 = times.length ? times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] : null;
  const incidents = incidentResult.data ?? [];
  const renewals = renewalsResult.data ?? [];
  const failedChecks = confirmedHttpChecks.filter((check) => !check.success);
  const endpointUrls = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.endpoint_url]));
  const failureCategories = new Map<string, number>();
  for (const check of failedChecks) {
    const category = check.http_status ? `HTTP ${check.http_status}` : check.error_code ?? "Request failed";
    failureCategories.set(category, (failureCategories.get(category) ?? 0) + 1);
  }
  type ReportPlugin = { slug: string; name: string; version: string; update_status: "available" | "unavailable" | "unknown"; update_version?: string | null };
  const latestWordPressReport = wordpressReportResult.data?.[0] as { plugins: ReportPlugin[]; spam_comment_count: number } | undefined;
  const wpUpdateCount = latestWordPressReport?.plugins.filter((plugin) => plugin.update_status === "available").length ?? 0;
  const wpUnknownUpdateCount = latestWordPressReport?.plugins.filter((plugin) => plugin.update_status === "unknown").length ?? 0;
  const reportSummary = includeSummary ? buildReportSummary({
    uptimePercent: uptime,
    uptimeChecks: confirmedHttpChecks.length,
    averageResponseMs: average,
    p95ResponseMs: p95,
    incidents,
    sslChecks: sslChecks.length,
    sslPassed: sslChecks.filter((check) => check.success).length,
    performanceScores: [...performanceChecks].reverse().map((check) => typeof check.metadata?.performance_score === "number" ? check.metadata.performance_score : null),
    wordpress: website.platform === "wordpress" ? { reportCount: wordpressReportResult.count ?? 0, updateCount: wpUpdateCount, updateUnknownCount: wpUnknownUpdateCount, spamCount: latestWordPressReport?.spam_comment_count ?? 0 } : null,
  }) : null;
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  const platformLabel = website.platform === "wordpress" ? "WordPress" : website.platform === "nextjs" ? "Next.js" : website.platform === "other" ? "Other" : "Not specified";
  const line = (item: PdfLine): PdfLine => item;
  const lines: PdfLine[] = [
    { text: "MONTH AT A GLANCE", kind: "section" },
    { text: `${uptime === null ? "Availability: no confirmed check data recorded" : `Availability: ${uptime.toFixed(2)}% across ${confirmedHttpChecks.length.toLocaleString()} confirmed external checks`}`, size: 12, bold: true, gap: 5, ...(uptime !== null && uptime < 99 ? { kind: "alert" as const } : {}) },
    { text: `Response time: ${average === null ? "not measured" : `${average} ms average (P95 ${p95} ms)`}     |     Incidents: ${incidents.length}     |     Performance scans: ${performanceChecks.length}`, size: 9, gap: 8 },
    { text: "Coverage is based on configured checks and records received during this reporting period. “No data” means no measurement was recorded.", kind: "note", gap: 12 },
    { text: "SERVICE SUMMARY", kind: "section" },
    { text: `Uptime: ${uptime === null ? "No data" : `${uptime.toFixed(2)}%`} (${confirmedHttpChecks.length.toLocaleString()} confirmed checks; ${uncertainChecks.length.toLocaleString()} unconfirmed)` },
    { text: `Average response time: ${average === null ? "No data" : `${average} ms`} | P95: ${p95 === null ? "No data" : `${p95} ms`}` },
    { text: `Incidents overlapping period: ${incidents.length}` },
    { text: sslAssets.length ? `TLS checks: ${sslChecks.filter((check) => check.success).length} passed, ${sslChecks.filter((check) => !check.success).length} failed (${sslChecks.length} total)` : "TLS checks: Not monitored; add an SSL certificate asset. Domain registration tracking does not monitor the website certificate." },
    { text: `Performance scans: ${performanceChecks.length} | Platform: ${platformLabel}`, gap: 12 },
    ...(reportSummary ? [
      line({ text: "EXECUTIVE NOTES", kind: "section" }),
      ...reportSummary.overview.map((text): PdfLine => ({ text: `• ${text}` })),
      line({ text: "Suggested follow-ups", kind: "subheading", gap: 2 }),
      ...reportSummary.followUps.map((text): PdfLine => ({ text: `- ${text}` })),
      line({ text: "Rule-based summary of recorded measurements; missing checks are not treated as passed.", kind: "note", gap: 10 }),
    ] : []),
    { text: "WEBSITE AVAILABILITY AND ERRORS", kind: "section", pageBreak: true },
    { text: `Failed external HTTP checks: ${failedChecks.length} of ${confirmedHttpChecks.length} confirmed checks; ${uncertainChecks.length} monitor network failures were unconfirmed`, bold: true, ...(failedChecks.length ? { kind: "alert" as const } : {}) },
    ...(failureCategories.size ? [...failureCategories].sort((a, b) => b[1] - a[1]).map(([category, count]): PdfLine => ({ text: `${category}: ${count}` })) : [{ text: "No failed external HTTP checks were recorded." }]),
    ...(failedChecks.length ? [
      { text: "Most recent failed checks (up to 30):", kind: "subheading", gap: 3 },
      ...failedChecks.slice(0, 30).map((check): PdfLine => ({ text: `${formatDate(check.checked_at, context.timeZone)} | ${endpointUrls.get(check.endpoint_id ?? "") ?? website.primary_url} | ${check.http_status ? `HTTP ${check.http_status}` : check.error_code ?? "Request failed"}${check.sanitized_error_message && check.sanitized_error_message !== "Request failed" ? ` · ${check.sanitized_error_message}` : ""}` })),
    ] : []),
    { text: `${uncertainChecks.length} network failure(s) had no HTTP response, so site status is unconfirmed; these are excluded from availability and confirmed failure totals. Internal WordPress/PHP server logs are not connected.`, kind: "note", gap: 5 },
    { text: "PERFORMANCE TREND", kind: "section", pageBreak: true },
    ...(performanceChecks.length ? performanceChecks.map((check): PdfLine => {
      const metrics = check.metadata ?? {};
      return { text: `${formatDate(check.checked_at, context.timeZone)} | score ${value(metrics.performance_score, "/100")} | LCP ${value(metrics.lcp_ms, " ms")} | INP ${value(metrics.inp_ms, " ms")} | CLS ${value(metrics.cls, "")}` };
    }) : [{ text: "No performance scans were recorded during this period." }]),
    ...(website.platform === "wordpress" ? [
      { text: "WORDPRESS SECURITY SNAPSHOT", kind: "section", gap: 3 },
      ...(latestWordPressReport ? [
        { text: `Inventory reports received: ${wordpressReportResult.count ?? 0}` },
        { text: `Plugin updates available in latest inventory: ${wpUpdateCount}` },
        { text: `Plugin update status unknown in latest inventory: ${wpUnknownUpdateCount}` },
        ...latestWordPressReport.plugins.filter((plugin) => plugin.update_status === "available").map((plugin): PdfLine => ({ text: `Update available: ${plugin.name} ${plugin.version}${plugin.update_version ? ` -> ${plugin.update_version}` : ""}` })),
        { text: `Spam comments in latest inventory: ${latestWordPressReport.spam_comment_count}` },
        { text: "Vulnerability findings and suspicious activity: Not checked by this inventory connector." },
      ] : [{ text: "No WordPress inventory was received during this period. Plugin updates, spam counts, vulnerability findings, and suspicious activity are unknown." }]),
    ] : []),
    { text: "TLS AND CERTIFICATE STATUS", kind: "section", pageBreak: true },
    ...(sslAssets.length ? sslAssets.map((asset): PdfLine => {
      const latest = [...sslChecks].filter((check) => check.asset_id === asset.id).sort((a, b) => b.checked_at.localeCompare(a.checked_at))[0];
      return { text: `${asset.service_name ?? asset.hostname ?? "Certificate"} | ${latest ? latest.success ? "Valid at last check" : latest.sanitized_error_message ?? "Invalid at last check" : "No check in period"} | Expires ${asset.expiry_date ?? "unknown"}` };
    }) : [{ text: "No SSL certificate assets are configured. The primary domain asset tracks registration expiry, not website TLS status." }]),
    { text: "INCIDENTS", kind: "section", gap: 3 },
    ...(incidents.length ? incidents.map((incident): PdfLine => ({ text: `${incident.summary} | ${incident.severity} ${incident.status} | Started ${formatDate(incident.started_at, context.timeZone)}${incident.resolved_at ? ` | Resolved ${formatDate(incident.resolved_at, context.timeZone)}` : " | Open at report time"}` })) : [{ text: "No incidents overlapped this period." }]),
    { text: "RECORDED MAINTENANCE ACTIVITY", kind: "section", gap: 3 },
    ...(renewals.length ? renewals.map((renewal): PdfLine => {
      const asset = assets.find((item) => item.id === renewal.asset_id);
      return { text: `${asset?.service_name ?? asset?.hostname ?? "Service"} renewal | ${renewal.previous_expiry_date ?? "unknown"} -> ${renewal.new_expiry_date ?? "unknown"} | ${formatDate(renewal.created_at, context.timeZone)}${renewal.confirmation_notes ? ` | ${renewal.confirmation_notes}` : ""}` };
    }) : [{ text: "No renewal actions were recorded. Other maintenance work is not currently logged in Monitor." }]),
    { text: `Generated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: context.timeZone }).format(new Date())} (${context.timeZone}).`, kind: "note", gap: 2 },
    { text: "Monitoring coverage depends on configured endpoints, certificate assets, worker schedules, and retained check history.", kind: "note" },
  ];
  const pdf = createPdf(lines, {
    title: "Website Monthly Maintenance Report",
    period: monthLabel,
    client: clientName,
    website: website.name,
    url: website.primary_url,
  });
  const escapedMessage = escapeHtml(message).replaceAll("\n", "<br />");
  const resend = new Resend(apiKey);
  let accepted = false;
  try {
    const result = await resend.emails.send({
      from,
      to: parsedRecipients.data[0]!,
      ...(parsedRecipients.data.length > 1 ? { bcc: parsedRecipients.data.slice(1) } : {}),
      subject,
      text: `${message}\n\nThe ${monthLabel} website maintenance report for ${website.name} is attached as a PDF.`,
      html: `<p>${escapedMessage}</p><p>The ${escapeHtml(monthLabel)} website maintenance report for <strong>${escapeHtml(website.name)}</strong> is attached as a PDF.</p>`,
      attachments: [{ filename: `${safeFilename(website.name)}-${month}-maintenance-report.pdf`, content: pdf, contentType: "application/pdf" }],
    });
    accepted = !result.error;
    if (result.error) {
      const providerError = result.error as { name?: string; message?: string; statusCode?: number; [key: string]: unknown };
      const providerCode = typeof providerError.name === "string" ? providerError.name : "resend_error";
      const providerStatus = typeof providerError.statusCode === "number" ? providerError.statusCode : undefined;
      const userMessage = sanitizeProviderError(providerError.message);
      console.error("Monthly report email send failed", { code: providerCode, status: providerStatus, message: userMessage });
      redirect(`${reportPath}&emailError=${encodeURIComponent(providerCode)}&emailDetail=${encodeURIComponent(userMessage)}`);
    }
  } catch (error) {
    // Next redirects throw to end the server action; preserve that control flow.
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Monthly report email send failed", { code: "network_failure" });
    redirect(`${reportPath}&emailError=network_failure`);
  }
  if (!accepted) redirect(`${reportPath}&emailError=send`);
  redirect(`${reportPath}&emailSent=1`);
}

async function loadChecks(
  client: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  start: Date,
  end: Date,
  checkType: "http" | "performance" | "ssl",
  target: "endpoint_id" | "website_id" | "asset_id",
  ids: string[],
): Promise<CheckRecord[]> {
  const checks: CheckRecord[] = [];
  const batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await client.from("check_results")
      .select("id, checked_at, success, http_status, error_code, response_time_ms, sanitized_error_message, asset_id, endpoint_id, metadata")
      .eq("organization_id", organizationId).eq("check_type", checkType)
      .gte("checked_at", start.toISOString()).lt("checked_at", end.toISOString())
      .in(target, ids).order("checked_at", { ascending: false }).range(offset, offset + batchSize - 1);
    if (error) throw error;
    const page = (data ?? []) as CheckRecord[];
    checks.push(...page);
    if (page.length < batchSize) return checks;
  }
}

function zonedDateToUtc(year: number, monthIndex: number, day: number, timeZone: string): Date {
  const target = Date.UTC(year, monthIndex, day);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(target));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const observed = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(target + target - observed);
}

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone }).format(new Date(value));
}

function value(input: unknown, suffix: string): string {
  return typeof input === "number" && Number.isFinite(input) ? `${Number(input.toFixed(2))}${suffix}` : "-";
}

function safeFilename(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "website";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function sanitizeProviderError(value: unknown): string {
  if (typeof value !== "string") return "The provider rejected the request. Check the sender and recipient configuration.";
  const cleaned = value
    .replace(/\b(?:re|sk)_[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.slice(0, 240) || "The provider rejected the request. Check the sender and recipient configuration.";
}
