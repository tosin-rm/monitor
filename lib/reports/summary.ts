export type ReportSummaryInput = {
  uptimePercent: number | null;
  uptimeChecks: number;
  averageResponseMs: number | null;
  p95ResponseMs: number | null;
  incidents: Array<{ severity: string; status: string }>;
  sslChecks: number;
  sslPassed: number;
  performanceScores: Array<number | null>;
  wordpress: { reportCount: number; updateCount: number; updateUnknownCount: number; spamCount: number } | null;
};

export type ReportSummary = { overview: string[]; followUps: string[] };

export function buildReportSummary(input: ReportSummaryInput): ReportSummary {
  const overview: string[] = [];
  const followUps: string[] = [];

  overview.push(input.uptimeChecks
    ? `Monitor recorded ${input.uptimeChecks} uptime checks and measured ${input.uptimePercent!.toFixed(2)}% observed availability.`
    : "No uptime checks were recorded, so availability for this period cannot be assessed.");
  overview.push(input.averageResponseMs === null
    ? "No response-time measurements were available."
    : `Average response time was ${input.averageResponseMs} ms${input.p95ResponseMs === null ? "." : `, with a 95th percentile of ${input.p95ResponseMs} ms.`}`);

  const openIncidents = input.incidents.filter((incident) => !["resolved", "suppressed"].includes(incident.status));
  overview.push(input.incidents.length
    ? `${input.incidents.length} incident${input.incidents.length === 1 ? "" : "s"} overlapped this period${openIncidents.length ? `; ${openIncidents.length} remain open or in progress` : "."}`
    : "No incidents are recorded as overlapping this period.");
  if (openIncidents.length) followUps.push(`Review ${openIncidents.length} open or in-progress incident${openIncidents.length === 1 ? "" : "s"} and record the resolution or next step.`);

  overview.push(input.sslChecks
    ? `${input.sslPassed} of ${input.sslChecks} TLS checks succeeded${input.sslPassed < input.sslChecks ? `; ${input.sslChecks - input.sslPassed} failed` : "."}`
    : "No TLS checks were recorded, so certificate health cannot be assessed for this period.");
  if (input.sslChecks > input.sslPassed) followUps.push("Review the failed TLS checks and confirm certificate validity and renewal status.");

  const scores = input.performanceScores.filter((score): score is number => score !== null && Number.isFinite(score));
  overview.push(input.performanceScores.length
    ? scores.length >= 2
      ? `The mobile performance score changed from ${scores[0]}/100 to ${scores.at(-1)}/100 across the recorded scans.`
      : scores.length === 1
        ? `One mobile performance score was recorded: ${scores[0]}/100; a trend cannot yet be calculated.`
        : `${input.performanceScores.length} performance scan${input.performanceScores.length === 1 ? " was" : "s were"} recorded, but no score was available.`
    : "No performance scans were recorded, so performance trends cannot be assessed.");
  if (!input.uptimeChecks) followUps.push("Configure or re-enable uptime checks to establish an availability baseline.");
  if (!input.sslChecks) followUps.push("Configure certificate monitoring if TLS health should be included in future reports.");
  if (!input.performanceScores.length) followUps.push("Run performance checks during the next reporting period to establish a trend.");

  if (input.wordpress) {
    overview.push(input.wordpress.reportCount
      ? `WordPress inventory was received ${input.wordpress.reportCount} time${input.wordpress.reportCount === 1 ? "" : "s"}; ${input.wordpress.updateCount} plugin${input.wordpress.updateCount === 1 ? " has" : "s have"} an update available, ${input.wordpress.updateUnknownCount} plugin update status${input.wordpress.updateUnknownCount === 1 ? " is" : "es are"} unknown, and ${input.wordpress.spamCount} spam comment${input.wordpress.spamCount === 1 ? " was" : "s were"} reported.`
      : "No WordPress inventory report was received during this period.");
    overview.push("Plugin vulnerability findings and suspicious activity were not checked by the connected inventory feed.");
    if (input.wordpress.updateCount > 0) followUps.push(`Review ${input.wordpress.updateCount} available plugin update${input.wordpress.updateCount === 1 ? "" : "s"} in WordPress admin.`);
    if (input.wordpress.spamCount > 0) followUps.push(`Review ${input.wordpress.spamCount} spam comment${input.wordpress.spamCount === 1 ? "" : "s"} in the WordPress spam queue.`);
    followUps.push("Connect a vulnerability or security scanner before drawing conclusions about vulnerable plugins or suspicious activity.");
  }

  if (!followUps.length) followUps.push("No follow-up was triggered by the available measurements. Unreported checks remain outside this summary.");
  return { overview, followUps };
}
