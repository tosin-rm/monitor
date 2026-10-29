"use client";

import { useState, useTransition } from "react";
import { createWordPressPairing, revokeWordPressConnector } from "@/app/websites/[websiteId]/wordpress-connector-actions";
import type { ConnectorSecurityReport, ProposedConnectorSecurityReport } from "@/lib/wordpress-connector/security-types";
import { isSecurityDataStale } from "@/lib/wordpress-connector/status";
import type { CentralVulnerabilityAssessment } from "@/lib/wordpress-connector/vulnerability-assessment";

type Plugin = { slug: string; name: string; version: string; active: boolean; update_status: "available" | "unavailable" | "unknown"; update_version?: string | null };
type Props = {
  websiteId: string;
  websiteUrl: string;
  canManage: boolean;
  stale: boolean;
  evaluatedAt: string;
  vulnerability: CentralVulnerabilityAssessment | null;
  connection: { id: string; status: string; paired_at: string; last_report_at: string | null; last_error_code: string | null } | null;
  latest: { collected_at: string; wordpress_version: string; plugins: Plugin[]; spam_comment_count: number; security_report?: ConnectorSecurityReport | ProposedConnectorSecurityReport | Record<string, never> } | null;
};

export function WordPressSecurityPanel({ websiteId, websiteUrl, canManage, stale, evaluatedAt, vulnerability, connection, latest }: Props) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, startTransition] = useTransition();
  const pending = () => setMessage("");
  const connected = connection?.status === "active";
  const inventoryAvailable = connected && latest !== null;
  const updateCount = latest?.plugins.filter((plugin) => plugin.update_status === "available").length ?? null;
  const unknownUpdateCount = latest?.plugins.filter((plugin) => plugin.update_status === "unknown").length ?? null;
  const legacySecurity = latest?.security_report && "vulnerability_check" in latest.security_report ? latest.security_report as ConnectorSecurityReport : null;
  const proposedSecurity = latest?.security_report && "vulnerability_data" in latest.security_report ? latest.security_report as ProposedConnectorSecurityReport : null;
  const coreIntegrity = proposedSecurity?.core_integrity ?? null;
  const security = legacySecurity;
  const activityScan = security?.activity_scan;
  const scanStale = isSecurityDataStale(activityScan?.last_successful_scan_at, evaluatedAt, 30 * 24 * 60 * 60_000);
  const advisories = vulnerability?.advisories ?? [];
  const advisoryGroups = new Map<string, typeof advisories>();
  for (const advisory of advisories) {
    const group = advisoryGroups.get(advisory.software_slug) ?? [];
    group.push(advisory);
    advisoryGroups.set(advisory.software_slug, group);
  }
  const affectedPluginCount = advisoryGroups.size;
  const findings = activityScan?.findings ?? [];
  const feedAvailable = vulnerability?.status === "current" || vulnerability?.status === "refresh_failed" || vulnerability?.status === "stale";

  return <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div><h2 className="text-sm font-bold text-slate-900">WordPress security</h2><p className="mt-0.5 text-[11px] text-slate-400">Connector inventory and security-check coverage</p></div>
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${connection?.last_error_code ? "bg-red-50 text-red-700" : connected && !stale ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{!connected ? connection?.status === "revoked" ? "Connection revoked" : "Connection unavailable" : connection.last_error_code ? "Report error" : stale ? "Report stale" : "Connected"}</span>
    </div>
    {inventoryAvailable && latest ? <>
      <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <Metric label="WordPress version" value={latest.wordpress_version} detail="From latest inventory" />
        <Metric label="Plugins needing updates" value={String(updateCount)} detail={`${unknownUpdateCount} plugin update status${unknownUpdateCount === 1 ? "" : "es"} unknown · ${latest.plugins.length} installed`} tone={updateCount ? "warning" : unknownUpdateCount ? "unknown" : "normal"} />
        <Metric label="Known plugin vulnerabilities" value={vulnerabilityMetric(vulnerability, stale)} detail={vulnerability?.fetchedAt ? `${advisories.length} advisory record${advisories.length === 1 ? "" : "s"} across ${affectedPluginCount} plugin${affectedPluginCount === 1 ? "" : "s"} · last feed sync ${formatTimestamp(vulnerability.fetchedAt)}${stale ? " · site inventory is stale" : ""}` : vulnerability?.status === "not_configured" ? "Configure the Wordfence Intelligence key and scheduled feed sync in Monitor" : "No successful Wordfence feed sync is available"} tone={feedAvailable && advisories.length ? "warning" : "unknown"} />
        <div className="px-5 py-4"><p className="text-[10px] text-slate-400">Spam comments</p><p className={`mt-1 text-lg font-bold ${latest.spam_comment_count ? "text-amber-700" : "text-slate-900"}`}>{latest.spam_comment_count.toLocaleString()}</p><p className="mt-1 text-[10px] text-slate-400">Count only; no comment data stored</p>{latest.spam_comment_count > 0 && <a href={wordpressAdminLink(websiteUrl, "edit-comments.php?comment_status=spam")} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[10px] font-semibold text-red-700 hover:underline">Review spam comments in WordPress <span aria-hidden="true">↗</span></a>}</div>
      </div>
      <div className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-2 xl:grid-cols-3">
        <Coverage label="Suspicious activity" value={proposedSecurity ? statusDisplay(proposedSecurity.suspicious_activity.status, proposedSecurity.suspicious_activity.findings.length) : !activityScan ? "Not reported" : activityScan.status === "complete_with_findings" ? `${findings.length} finding${findings.length === 1 ? "" : "s"}${scanStale ? " · stale" : ""}` : activityScan.status === "complete_with_no_findings" ? scanStale ? "Last scan is stale" : "No findings in last scan" : titleStatus(activityScan.status)} detail={proposedSecurity ? `${proposedSecurity.suspicious_activity.source ?? "No scanner source"} · ${proposedSecurity.suspicious_activity.findings.length} reported finding(s)` : activityScan?.scanner ? `${sourceName(activityScan.scanner)} · scan ${activityScan.scan_completed_at ? formatTimestamp(activityScan.scan_completed_at) : activityScan.status}` : "No supported scanner has reported results"} />
        <Coverage label="WordPress core file integrity" value={!coreIntegrity ? "Not reported" : coreIntegrity.status !== "complete" ? "Unavailable · unknown" : coreIntegrity.modified_file_count || coreIntegrity.missing_file_count ? `${coreIntegrity.modified_file_count} changed · ${coreIntegrity.missing_file_count} missing` : "No core file changes detected"} detail={!coreIntegrity ? "No core integrity result is available." : coreIntegrity.status === "complete" ? `${coreIntegrity.checked_file_count.toLocaleString()} official core files checked · ${formatTimestamp(coreIntegrity.checked_at as string)}. Plugins, themes, and uploads are not scanned.` : "Official WordPress core checksums or local files could not be checked; this is not a clean result."} />
        <Coverage label="Last successful malware/activity scan" value={proposedSecurity ? proposedSecurity.last_successful_scan_at ? proposedSecurity.scan_status === "stale" ? "Stale" : formatTimestamp(proposedSecurity.last_successful_scan_at) : "None recorded" : activityScan?.last_successful_scan_at ? scanStale ? "Stale" : formatTimestamp(activityScan.last_successful_scan_at) : "None recorded"} detail="Core integrity is shown separately. No malware scanner or activity log integration has completed a scan." />
      </div>
      {coreIntegrity?.status === "complete" && (coreIntegrity.modified_files.length > 0 || coreIntegrity.missing_files.length > 0) && <div className="border-t border-slate-100 px-5 py-4"><h3 className="text-xs font-bold text-slate-800">WordPress core files to review</h3><p className="mt-1 text-[10px] text-slate-500">A checksum difference can come from a legitimate edit; it is not by itself proof of malware.</p><div className="mt-2 divide-y divide-slate-100">{coreIntegrity.modified_files.map((file) => <div key={`modified-${file}`} className="py-2 text-xs text-amber-800">Changed from official checksum · <code>{file}</code></div>)}{coreIntegrity.missing_files.map((file) => <div key={`missing-${file}`} className="py-2 text-xs text-red-700">Missing core file · <code>{file}</code></div>)}</div>{coreIntegrity.findings_truncated && <p className="mt-2 text-[10px] text-slate-500">Only the first 100 file paths are shown.</p>}</div>}
      {advisoryGroups.size > 0 && <div className="border-t border-slate-100 px-5 py-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-xs font-bold text-slate-800">Known plugin advisories</h3><p className="text-[10px] text-slate-400">{affectedPluginCount} affected plugin{affectedPluginCount === 1 ? "" : "s"} · {advisories.length} advisory record{advisories.length === 1 ? "" : "s"}</p></div><div className="mt-3 space-y-3">{[...advisoryGroups].map(([slug, group]) => { const plugin = latest.plugins.find((item) => item.slug.toLowerCase() === slug); return <article key={slug} className="rounded-xl bg-slate-50 p-3.5"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><h4 className="truncate text-xs font-semibold text-slate-800">{plugin?.name ?? group[0].software_name}</h4><p className="mt-0.5 text-[10px] text-slate-500">{slug} · installed v{group[0].installed_version}</p></div><span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-700">{group.length} issue{group.length === 1 ? "" : "s"}</span></div><div className="mt-2 divide-y divide-slate-200/70">{group.map((advisory) => <div key={advisory.advisory_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-700">{advisory.title}</p><p className="mt-0.5 text-[10px] text-slate-500">{advisory.severity}{advisory.cvss_score !== null ? ` · CVSS ${advisory.cvss_score}` : ""}{advisory.patched_versions[0] ? ` · fixed in ${advisory.patched_versions[0]}` : ""}</p></div><a href={advisory.reference_url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-slate-600 hover:underline">Advisory ↗</a>{(advisory.defiant_notice || advisory.mitre_notice) && <details className="w-full text-[9px] text-slate-500"><summary className="cursor-pointer">Source attribution and license</summary><div className="mt-1 space-y-1">{advisory.defiant_notice && <p>{advisory.defiant_notice}</p>}{advisory.defiant_license && <p className="whitespace-pre-wrap">{advisory.defiant_license}</p>}{advisory.defiant_license_url && <p><a className="underline" href={advisory.defiant_license_url} target="_blank" rel="noopener noreferrer">Defiant license</a></p>}{advisory.mitre_notice && <p>{advisory.mitre_notice}</p>}{advisory.mitre_license && <p className="whitespace-pre-wrap">{advisory.mitre_license}</p>}{advisory.mitre_license_url && <p><a className="underline" href={advisory.mitre_license_url} target="_blank" rel="noopener noreferrer">MITRE license</a></p>}</div></details>}</div>)}</div><a href={wordpressAdminLink(websiteUrl, "plugins.php")} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-[10px] font-semibold text-red-700 hover:underline">Review this plugin in WordPress ↗</a></article>; })}</div></div>}
      {findings.length > 0 && <div className="border-t border-slate-100 px-5 py-4"><h3 className="text-xs font-bold text-slate-800">Scanner findings</h3><div className="mt-2 divide-y divide-slate-100">{findings.map((finding) => <div key={finding.finding_id} className="flex flex-wrap items-center gap-2 py-2"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-800">{finding.title}</p><p className="text-[10px] capitalize text-slate-500">{finding.category.replaceAll("_", " ")} · {finding.severity}{finding.detected_at ? ` · ${formatTimestamp(finding.detected_at)}` : ""}</p></div><a href={wordpressAdminLink(websiteUrl, "plugins.php")} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-red-700 hover:underline">Review WordPress admin ↗</a></div>)}</div></div>}
      <div className="border-t border-slate-100 px-5 py-4"><h3 className="text-xs font-bold text-slate-800">Installed plugins</h3>
        {latest.plugins.length ? <div className="mt-3 divide-y divide-slate-100">{latest.plugins.map((plugin) => { const matches = advisories.filter((advisory) => advisory.software_slug === plugin.slug.toLowerCase()); const unassessed = vulnerability?.unassessedSlugs.includes(plugin.slug) ?? false; const vulnLabel = matches.length ? `Vulnerable · ${matches[0].severity}${stale ? " · inventory stale" : ""}` : !feedAvailable ? "Vulnerability status unknown" : stale ? "Inventory stale" : unassessed ? "Version not assessed" : vulnerability?.status === "stale" ? "Feed stale" : "No known advisory"; const vulnTone = matches.length ? "bg-red-50 text-red-700" : !feedAvailable || stale || unassessed || vulnerability?.status === "stale" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"; return <div key={plugin.slug} className="flex flex-wrap items-center gap-2 py-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-700">{plugin.name}{plugin.active ? " · Active" : " · Inactive"}</p><p className="text-[10px] text-slate-400">{plugin.slug} · v{plugin.version}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${plugin.update_status === "available" ? "bg-amber-50 text-amber-700" : plugin.update_status === "unknown" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{plugin.update_status === "available" ? `Update ${plugin.update_version ? `· ${plugin.update_version}` : "available"}` : plugin.update_status === "unknown" ? "Update status unknown" : "No update reported"}</span><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${vulnTone}`}>{vulnLabel}</span>{plugin.update_status === "available" && <a href={wordpressAdminLink(websiteUrl, "plugins.php")} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-red-700 hover:underline">Review in WordPress <span aria-hidden="true">↗</span></a>}</div>; })}</div> : <p className="mt-2 text-xs text-slate-400">The connector reported zero installed plugins.</p>}
      </div>
    </> : <div className="grid gap-3 p-5 sm:grid-cols-2"><Coverage label="Plugin inventory and update status" value={!connected ? "Unavailable" : "Not run"} detail={!connected ? "Pair or reconnect the WordPress Connector to retrieve plugin data." : "The connector is paired but has not sent its first report."} /><Coverage label="Vulnerabilities, spam, and suspicious activity" value="Unknown" detail="No successful report is available. These checks are not considered clear." /><Coverage label="Last successful scan" value="None recorded" detail="No security scan result has been reported to Monitor." /></div>}
    {connection?.status === "active" && <p className={`border-t border-slate-100 px-5 py-3 text-[10px] ${connection.last_error_code ? "text-red-700" : "text-slate-400"}`}>{connection.last_error_code ? "The last report could not be saved. Check the plugin connection and try again." : `Last successful inventory sync: ${connection.last_report_at ? formatTimestamp(connection.last_report_at) : "Never"}${stale && connection.last_report_at ? " · Reports older than 24 hours are marked stale" : ""}`}</p>}
    {canManage && <div className="border-t border-slate-100 px-5 py-4">
      {code ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">One-time pairing code · expires in 15 minutes</p><div className="mt-2 flex flex-wrap items-center gap-2"><code className="break-all rounded bg-white px-2 py-1.5 text-xs text-slate-800">{code}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(code); setMessage("Pairing code copied."); }} className="rounded-md border border-amber-300 px-2.5 py-1.5 text-[10px] font-semibold text-amber-900">Copy code</button><button type="button" onClick={() => setCode("")} className="rounded-md px-2 py-1.5 text-[10px] font-semibold text-slate-600">Hide</button></div></div> : <div className="flex flex-wrap items-center gap-2">{connection?.status === "active" ? <button disabled={busy} onClick={() => { if (!window.confirm("Revoke this connector? The WordPress site will need to pair again.")) return; startTransition(async () => { const result = await revokeWordPressConnector(websiteId); setMessage(result.ok ? "Connector revoked." : "Could not revoke connector."); }); }} className="h-8 rounded-md border border-red-200 px-3 text-[10px] font-semibold text-red-700 disabled:opacity-50">Revoke connector</button> : <button disabled={busy} onClick={() => { pending(); startTransition(async () => { const result = await createWordPressPairing(websiteId); if (result.code) setCode(result.code); else setMessage(result.error === "forbidden" ? "You are not authorized to pair this website." : "Pairing code could not be created."); }); }} className="h-8 rounded-md bg-red-600 px-3 text-[10px] font-semibold text-white disabled:opacity-50">Create pairing code</button>}</div>}
      {message && <p role="status" className="mt-2 text-[10px] text-slate-600">{message}</p>}
    </div>}
  </section>;
}

function Metric({ label, value, detail, tone = "normal" }: { label: string; value: string; detail: string; tone?: "normal" | "warning" | "unknown" }) {
  const color = tone === "warning" ? "text-amber-700" : tone === "unknown" ? "text-slate-500" : "text-slate-900";
  return <div className="px-5 py-4"><p className="text-[10px] text-slate-400">{label}</p><p className={`mt-1 text-lg font-bold ${color}`}>{value}</p><p className="mt-1 text-[10px] text-slate-400">{detail}</p></div>;
}

function Coverage({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3"><p className="text-[10px] font-semibold text-slate-700">{label}</p><p className="mt-1 text-xs font-bold text-amber-800">{value}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p></div>;
}

function titleStatus(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusDisplay(status: string, findingCount: number): string {
  if (status === "completed") return findingCount ? `Completed · ${findingCount} finding${findingCount === 1 ? "" : "s"}` : "Completed · no findings";
  return ({ unavailable: "Unavailable · unknown", unsupported: "Unsupported · unknown", not_run: "Not run · unknown", stale: "Stale", error: "Error · unknown" } as Record<string, string>)[status] ?? "Unknown";
}

function sourceName(source: string): string {
  return ({ wordfence_intelligence: "Wordfence Intelligence", wordfence: "Wordfence", solid_security: "Solid Security", sucuri: "Sucuri", other: "External scanner" } as Record<string, string>)[source] ?? "Scanner";
}

function vulnerabilityMetric(vulnerability: CentralVulnerabilityAssessment | null, inventoryStale: boolean): string {
  if (!vulnerability) return "Not checked";
  const matches = vulnerability.advisories.length;
  const affectedPlugins = new Set(vulnerability.advisories.map((advisory) => advisory.software_slug)).size;
  const unassessed = vulnerability.unassessedSlugs.length;
  if (vulnerability.status === "not_configured") return "Not configured";
  if (vulnerability.status === "not_synced") return "Not synced";
  if (vulnerability.status === "failed") return "Unavailable";
  if (vulnerability.status === "stale") return matches ? `${affectedPlugins} plugin${affectedPlugins === 1 ? "" : "s"} · feed stale` : "Feed stale";
  if (inventoryStale) return matches ? `${affectedPlugins} plugin${affectedPlugins === 1 ? "" : "s"} · inventory stale` : "Inventory stale";
  if (vulnerability.status === "refresh_failed") return matches ? `${affectedPlugins} plugin${affectedPlugins === 1 ? "" : "s"} · refresh failed` : "Refresh failed";
  if (matches) return unassessed ? `${affectedPlugins} plugin${affectedPlugins === 1 ? "" : "s"} · ${unassessed} unassessed` : `${affectedPlugins} affected plugin${affectedPlugins === 1 ? "" : "s"}`;
  return vulnerability.coverageComplete ? "No known advisories" : `${unassessed} plugin${unassessed === 1 ? "" : "s"} not assessed`;
}

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function wordpressAdminLink(siteUrl: string, path: string): string {
  try {
    const base = new URL(siteUrl);
    base.search = "";
    base.hash = "";
    base.pathname = `${base.pathname.replace(/\/$/, "")}/wp-admin/`;
    return new URL(path, base).toString();
  } catch {
    return siteUrl;
  }
}
