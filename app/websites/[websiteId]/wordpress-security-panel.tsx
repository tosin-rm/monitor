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
  const softwareIntegrity = proposedSecurity?.software_integrity ?? null;
  const localFileScan = proposedSecurity?.local_file_scan ?? null;
  const security = legacySecurity;
  const activityScan = security?.activity_scan;
  const scanStale = isSecurityDataStale(activityScan?.last_successful_scan_at, evaluatedAt, 30 * 24 * 60 * 60_000);
  const installedPluginSlugs = new Set(latest?.plugins.map((plugin) => plugin.slug.toLowerCase()) ?? []);
  const advisories = (vulnerability?.advisories ?? []).filter((advisory) => installedPluginSlugs.has(advisory.software_slug.toLowerCase()));
  const advisoryGroups = new Map<string, typeof advisories>();
  for (const advisory of advisories) {
    const group = advisoryGroups.get(advisory.software_slug) ?? [];
    group.push(advisory);
    advisoryGroups.set(advisory.software_slug, group);
  }
  const affectedPluginCount = advisoryGroups.size;
  const findings = activityScan?.findings ?? [];
  const feedAvailable = vulnerability?.status === "current" || vulnerability?.status === "refresh_failed" || vulnerability?.status === "stale";
  const coreChangeCount = (coreIntegrity?.modified_file_count ?? 0) + (coreIntegrity?.missing_file_count ?? 0);
  const hasPriorityItems = affectedPluginCount > 0 || (updateCount ?? 0) > 0 || coreChangeCount > 0 || (softwareIntegrity?.modified_file_count ?? 0) > 0 || (softwareIntegrity?.missing_file_count ?? 0) > 0;
  const hasCoverageGaps = !feedAvailable || !vulnerability?.coverageComplete || Boolean(stale) || coreIntegrity?.status !== "complete" || localFileScan?.status !== "complete" || localFileScan?.coverage === "partial" || softwareIntegrity?.status === "partial" || softwareIntegrity?.status === "unavailable";
  const executiveStatus = hasPriorityItems ? "Action needed" : hasCoverageGaps ? "Coverage needs review" : "No known issues";

  return <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div><h2 className="text-sm font-bold text-slate-900">WordPress security</h2><p className="mt-0.5 text-[11px] text-slate-400">Connector inventory and security-check coverage</p></div>
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${connection?.last_error_code ? "bg-red-50 text-red-700" : connected && !stale ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{!connected ? connection?.status === "revoked" ? "Connection revoked" : "Connection unavailable" : connection.last_error_code ? "Report error" : stale ? "Report stale" : "Connected"}</span>
    </div>
    {inventoryAvailable && latest ? <>
      <div className="bg-slate-50/70 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Executive summary</p><h3 className="mt-1 text-base font-bold tracking-tight text-slate-900">{executiveStatus}</h3><p className="mt-1 text-[11px] text-slate-500">Based on {latest.plugins.length} plugins in the latest WordPress report · {formatTimestamp(latest.collected_at)}</p></div><span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${hasPriorityItems ? "bg-red-50 text-red-700" : hasCoverageGaps ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{hasPriorityItems ? "Review findings" : hasCoverageGaps ? "Some checks incomplete" : "Checks current"}</span></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <SummaryStat label="Known plugin vulnerabilities" value={affectedPluginCount ? `${affectedPluginCount} affected` : feedAvailable ? "None matched" : "Unknown"} detail={affectedPluginCount ? `${advisories.length} advisories · installed plugin versions matched` : vulnerability?.status === "current" ? "Current feed checked against reported plugins" : "Vulnerability feed or inventory needs review"} tone={affectedPluginCount ? "danger" : !feedAvailable ? "muted" : "good"} />
          <SummaryStat label="Plugin updates" value={updateCount === null ? "Unknown" : updateCount ? `${updateCount} available` : "None reported"} detail={`${unknownUpdateCount ?? 0} update status${unknownUpdateCount === 1 ? "" : "es"} unknown`} tone={updateCount ? "warning" : unknownUpdateCount ? "muted" : "good"} />
          <SummaryStat label="Core files" value={!coreIntegrity || coreIntegrity.status !== "complete" ? "Not verified" : coreChangeCount ? `${coreChangeCount} differences` : "Verified"} detail={!coreIntegrity || coreIntegrity.status !== "complete" ? "Checksum verification unavailable" : `${coreIntegrity.checked_file_count.toLocaleString()} core files checked`} tone={!coreIntegrity || coreIntegrity.status !== "complete" ? "muted" : coreChangeCount ? "warning" : "good"} />
        </div>
        {advisoryGroups.size > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold text-slate-500">Affected installed plugins:</span>{[...advisoryGroups].map(([slug, group]) => { const plugin = latest.plugins.find((item) => item.slug.toLowerCase() === slug); return <span key={slug} className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-medium text-red-800">{plugin?.name ?? group[0].software_name}{plugin && !plugin.active ? " · inactive" : ""} · {group.length}</span>; })}</div>}
        <p className="mt-3 text-[10px] leading-4 text-slate-400">Vulnerability matches use the latest reported installed-plugin list, including inactive plugins. Detailed evidence and scan coverage are below.</p>
      </div>
      <details className="group border-t border-slate-100">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><span>Inventory and technical details</span><span className="text-[10px] font-medium text-slate-400 group-open:hidden">Expand</span><span className="hidden text-[10px] font-medium text-slate-400 group-open:inline">Collapse</span></summary>
      <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <Metric label="WordPress version" value={latest.wordpress_version} detail="From latest inventory" />
        <Metric label="Plugins needing updates" value={String(updateCount)} detail={`${unknownUpdateCount} plugin update status${unknownUpdateCount === 1 ? "" : "es"} unknown · ${latest.plugins.length} installed`} tone={updateCount ? "warning" : unknownUpdateCount ? "unknown" : "normal"} />
        <Metric label="Known plugin vulnerabilities" value={vulnerabilityMetric(vulnerability, stale)} detail={vulnerability?.fetchedAt ? `${advisories.length} advisory record${advisories.length === 1 ? "" : "s"} across ${affectedPluginCount} plugin${affectedPluginCount === 1 ? "" : "s"} · last feed sync ${formatTimestamp(vulnerability.fetchedAt)}${stale ? " · site inventory is stale" : ""}` : vulnerability?.status === "not_configured" ? "Configure the Wordfence Intelligence key and scheduled feed sync in Monitor" : "No successful Wordfence feed sync is available"} tone={feedAvailable && advisories.length ? "warning" : "unknown"} />
        <div className="px-5 py-4"><p className="text-[10px] text-slate-400">Spam comments</p><p className={`mt-1 text-lg font-bold ${latest.spam_comment_count ? "text-amber-700" : "text-slate-900"}`}>{latest.spam_comment_count.toLocaleString()}</p><p className="mt-1 text-[10px] text-slate-400">Count only; no comment data stored</p>{latest.spam_comment_count > 0 && <a href={wordpressAdminLink(websiteUrl, "edit-comments.php?comment_status=spam")} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[10px] font-semibold text-red-700 hover:underline">Review spam comments in WordPress <span aria-hidden="true">↗</span></a>}</div>
      </div>
      <div className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-2 xl:grid-cols-3">
        <Coverage label="Suspicious activity" value={proposedSecurity ? statusDisplay(proposedSecurity.suspicious_activity.status, proposedSecurity.suspicious_activity.findings.length) : !activityScan ? "Not reported" : activityScan.status === "complete_with_findings" ? `${findings.length} finding${findings.length === 1 ? "" : "s"}${scanStale ? " · stale" : ""}` : activityScan.status === "complete_with_no_findings" ? scanStale ? "Last scan is stale" : "No findings in last scan" : titleStatus(activityScan.status)} detail={proposedSecurity ? `${proposedSecurity.suspicious_activity.source ?? "Activity log not connected"} · ${proposedSecurity.suspicious_activity.findings.length} reported event(s)` : activityScan?.scanner ? `${sourceName(activityScan.scanner)} · scan ${activityScan.scan_completed_at ? formatTimestamp(activityScan.scan_completed_at) : activityScan.status}` : "No login or security activity log source is connected. Local code inspection is shown separately."} />
        <Coverage label="WordPress core file integrity" value={!coreIntegrity ? "Not reported" : coreIntegrity.status !== "complete" ? "Unavailable · unknown" : coreIntegrity.modified_file_count || coreIntegrity.missing_file_count ? `${coreIntegrity.modified_file_count} changed · ${coreIntegrity.missing_file_count} missing` : "No core file changes detected"} detail={!coreIntegrity ? "No core integrity result is available." : coreIntegrity.status === "complete" ? `${coreIntegrity.checked_file_count.toLocaleString()} core files checked · ${coreIntegrity.excluded_content_file_count ?? 0} bundled wp-content files excluded · ${formatTimestamp(coreIntegrity.checked_at as string)}` : `Official checksums or safe local file access failed (${coreIntegrity.reason ?? "reason unavailable"}); this is not a clean result.`} />
        <Coverage label="Plugin file integrity" value={!softwareIntegrity || softwareIntegrity.status === "not_run" ? "Not run" : softwareIntegrity.status === "unavailable" ? "Unavailable · unknown" : softwareIntegrity.modified_file_count || softwareIntegrity.missing_file_count ? `${softwareIntegrity.modified_file_count} changed · ${softwareIntegrity.missing_file_count} missing` : softwareIntegrity.status === "partial" ? `${softwareIntegrity.checked_plugin_count} checked · partial` : "No changes detected"} detail={!softwareIntegrity || softwareIntegrity.status === "not_run" ? "No plugin files were available to check." : `${softwareIntegrity.checked_plugin_count} plugins / ${softwareIntegrity.checked_file_count.toLocaleString()} files checked against WordPress.org checksums · ${softwareIntegrity.unavailable_plugin_count} unsupported/unavailable · ${softwareIntegrity.not_checked_plugin_count} not checked${softwareIntegrity.checked_at ? ` · ${formatTimestamp(softwareIntegrity.checked_at)}` : ""}. Premium or custom plugins may not publish checksums.`} />
        <Coverage label="Local code inspection" value={!localFileScan || localFileScan.status === "unavailable" ? "Unavailable · unknown" : localFileScan.findings.length ? `${localFileScan.findings.length}${localFileScan.findings_truncated ? "+" : ""} possible indicator${localFileScan.findings.length === 1 ? "" : "s"}` : "No indicators found"} detail={!localFileScan || localFileScan.status === "unavailable" ? "Local PHP files could not be safely inspected." : `${localFileScan.checked_file_count.toLocaleString()} PHP files inspected · ${localFileScan.coverage === "partial" ? "coverage is partial due scan limits" : "coverage complete"} · heuristic patterns only, not an antivirus scan${localFileScan.checked_at ? ` · ${formatTimestamp(localFileScan.checked_at)}` : ""}.`} />
        <Coverage label="Malware signature scan" value="Not configured" detail="No antivirus signature engine or login/activity log is connected. The local code inspection is a limited heuristic scan." />
      </div>
      {coreIntegrity?.status === "complete" && (coreIntegrity.modified_files.length > 0 || coreIntegrity.missing_files.length > 0) && <div className="border-t border-slate-100 px-5 py-4"><h3 className="text-xs font-bold text-slate-800">WordPress core files to review</h3><p className="mt-1 text-[10px] text-slate-500">A checksum difference can come from a legitimate edit; it is not by itself proof of malware.</p><div className="mt-2 divide-y divide-slate-100">{coreIntegrity.modified_files.map((file) => <div key={`modified-${file}`} className="py-2 text-xs text-amber-800">Changed from official checksum · <code>{file}</code></div>)}{coreIntegrity.missing_files.map((file) => <div key={`missing-${file}`} className="py-2 text-xs text-red-700">Missing core file · <code>{file}</code></div>)}</div>{coreIntegrity.findings_truncated && <p className="mt-2 text-[10px] text-slate-500">Only the first 100 file paths are shown.</p>}</div>}
      {softwareIntegrity && (softwareIntegrity.modified_files.length > 0 || softwareIntegrity.missing_files.length > 0) && <div className="border-t border-slate-100 px-5 py-4"><h3 className="text-xs font-bold text-slate-800">Plugin files to review</h3><p className="mt-1 text-[10px] text-slate-500">A difference can come from a legitimate customization; review before taking action.</p><div className="mt-2 divide-y divide-slate-100">{softwareIntegrity.modified_files.map((file) => <div key={`plugin-modified-${file}`} className="py-2 text-xs text-amber-800">Changed from WordPress.org checksum · <code>{file}</code></div>)}{softwareIntegrity.missing_files.map((file) => <div key={`plugin-missing-${file}`} className="py-2 text-xs text-red-700">Missing plugin file · <code>{file}</code></div>)}</div>{softwareIntegrity.findings_truncated && <p className="mt-2 text-[10px] text-slate-500">Only the first 100 file paths are shown.</p>}</div>}
      {localFileScan?.findings.length ? <div className="border-t border-slate-100 px-5 py-4"><h3 className="text-xs font-bold text-slate-800">Possible suspicious code patterns</h3><p className="mt-1 text-[10px] text-slate-500">Heuristic matches can be legitimate. Review files before taking action; file contents are not sent to Monitor.</p><div className="mt-2 divide-y divide-slate-100">{localFileScan.findings.map((finding, index) => <div key={String(finding.finding_id ?? index)} className="py-2"><p className="text-xs font-medium text-amber-800">{String(finding.title ?? "Potentially risky code pattern")}</p><p className="mt-0.5 text-[10px] text-slate-500"><code>{String(finding.path ?? "Path unavailable")}</code> · {String(finding.rule ?? "static heuristic")}</p></div>)}</div>{localFileScan.findings_truncated && <p className="mt-2 text-[10px] text-slate-500">Additional findings were omitted from this report.</p>}</div> : null}
      {advisoryGroups.size > 0 && <div id="wordpress-advisories" className="border-t border-slate-100 px-5 py-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-xs font-bold text-slate-800">Advisories matched to installed plugins</h3><p className="text-[10px] text-slate-400">{affectedPluginCount} affected plugin{affectedPluginCount === 1 ? "" : "s"} · {advisories.length} advisory record{advisories.length === 1 ? "" : "s"}</p></div><p className="mt-1 text-[10px] text-slate-500">Each item below matches a plugin slug and installed version from the latest WordPress report. Inactive plugins are included because their files remain on the site.</p><div className="mt-3 space-y-3">{[...advisoryGroups].map(([slug, group]) => { const plugin = latest.plugins.find((item) => item.slug.toLowerCase() === slug); return <article key={slug} className="rounded-xl bg-slate-50 p-3.5"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><h4 className="truncate text-xs font-semibold text-slate-800">{plugin?.name ?? group[0].software_name}</h4><p className="mt-0.5 text-[10px] text-slate-500">{slug} · installed v{group[0].installed_version} · {plugin?.active ? "active" : "inactive"}</p></div><span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-700">{group.length} issue{group.length === 1 ? "" : "s"}</span></div><div className="mt-2 divide-y divide-slate-200/70">{group.map((advisory) => <div key={advisory.advisory_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-700">{advisory.title}</p><p className="mt-0.5 text-[10px] text-slate-500">{advisory.severity}{advisory.cvss_score !== null ? ` · CVSS ${advisory.cvss_score}` : ""}{advisory.patched_versions[0] ? ` · fixed in ${advisory.patched_versions[0]}` : ""}</p></div><a href={advisory.reference_url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-slate-600 hover:underline">Advisory ↗</a>{(advisory.defiant_notice || advisory.mitre_notice) && <details className="w-full text-[9px] text-slate-500"><summary className="cursor-pointer">Source attribution and license</summary><div className="mt-1 space-y-1">{advisory.defiant_notice && <p>{advisory.defiant_notice}</p>}{advisory.defiant_license && <p className="whitespace-pre-wrap">{advisory.defiant_license}</p>}{advisory.defiant_license_url && <p><a className="underline" href={advisory.defiant_license_url} target="_blank" rel="noopener noreferrer">Defiant license</a></p>}{advisory.mitre_notice && <p>{advisory.mitre_notice}</p>}{advisory.mitre_license && <p className="whitespace-pre-wrap">{advisory.mitre_license}</p>}{advisory.mitre_license_url && <p><a className="underline" href={advisory.mitre_license_url} target="_blank" rel="noopener noreferrer">MITRE license</a></p>}</div></details>}</div>)}</div><a href={wordpressAdminLink(websiteUrl, "plugins.php")} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-[10px] font-semibold text-red-700 hover:underline">Review this plugin in WordPress ↗</a></article>; })}</div></div>}
      {findings.length > 0 && <div className="border-t border-slate-100 px-5 py-4"><h3 className="text-xs font-bold text-slate-800">Scanner findings</h3><div className="mt-2 divide-y divide-slate-100">{findings.map((finding) => <div key={finding.finding_id} className="flex flex-wrap items-center gap-2 py-2"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-800">{finding.title}</p><p className="text-[10px] capitalize text-slate-500">{finding.category.replaceAll("_", " ")} · {finding.severity}{finding.detected_at ? ` · ${formatTimestamp(finding.detected_at)}` : ""}</p></div><a href={wordpressAdminLink(websiteUrl, "plugins.php")} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-red-700 hover:underline">Review WordPress admin ↗</a></div>)}</div></div>}
      <div className="border-t border-slate-100 px-5 py-4"><h3 className="text-xs font-bold text-slate-800">Installed plugins</h3>
        {latest.plugins.length ? <div className="mt-3 divide-y divide-slate-100">{latest.plugins.map((plugin) => { const matches = advisories.filter((advisory) => advisory.software_slug === plugin.slug.toLowerCase()); const unassessed = vulnerability?.unassessedSlugs.includes(plugin.slug) ?? false; const vulnLabel = matches.length ? `Vulnerable · ${matches[0].severity}${stale ? " · inventory stale" : ""}` : !feedAvailable ? "Vulnerability status unknown" : stale ? "Inventory stale" : unassessed ? "Version not assessed" : vulnerability?.status === "stale" ? "Feed stale" : "No known advisory"; const vulnTone = matches.length ? "bg-red-50 text-red-700" : !feedAvailable || stale || unassessed || vulnerability?.status === "stale" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"; return <div key={plugin.slug} className="flex flex-wrap items-center gap-2 py-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-700">{plugin.name}{plugin.active ? " · Active" : " · Inactive"}</p><p className="text-[10px] text-slate-400">{plugin.slug} · v{plugin.version}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${plugin.update_status === "available" ? "bg-amber-50 text-amber-700" : plugin.update_status === "unknown" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{plugin.update_status === "available" ? `Update ${plugin.update_version ? `· ${plugin.update_version}` : "available"}` : plugin.update_status === "unknown" ? "Update status unknown" : "No update reported"}</span><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${vulnTone}`}>{vulnLabel}</span>{plugin.update_status === "available" && <a href={wordpressAdminLink(websiteUrl, "plugins.php")} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-red-700 hover:underline">Review in WordPress <span aria-hidden="true">↗</span></a>}</div>; })}</div> : <p className="mt-2 text-xs text-slate-400">The connector reported zero installed plugins.</p>}
      </div>
      </details>
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

function SummaryStat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "danger" | "warning" | "muted" | "good" }) {
  const styles = { danger: "text-red-700", warning: "text-amber-700", muted: "text-slate-500", good: "text-emerald-700" };
  return <div className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100"><p className="text-[10px] font-medium text-slate-400">{label}</p><p className={`mt-1 text-sm font-bold ${styles[tone]}`}>{value}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p></div>;
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
