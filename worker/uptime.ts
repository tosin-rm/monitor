import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeHttpCheck } from "@/lib/ssrf/safe-fetch";
import { SsrfError } from "@/lib/ssrf/validate";
import { inspectCertificate } from "@/lib/ssl/inspect";
import type { CertificateInspection } from "@/lib/ssl/inspect";
import {
  classifyWorkerVsSiteFailure,
  isExpectedStatus,
} from "@/lib/uptime/evaluate";
import type { NotificationPayload } from "@/lib/notifications/types";

type Endpoint = {
  id: string;
  organization_id: string;
  website_id: string;
  endpoint_url: string;
  expected_status_codes: number[];
  check_interval_seconds: number;
  timeout_seconds: number;
  follow_redirects: boolean;
  max_redirects: number;
  consecutive_failure_threshold: number;
  consecutive_failures: number;
  last_checked_at: string | null;
};

type CertificateAsset = {
  id: string;
  organization_id: string;
  website_id: string;
  hostname: string | null;
  service_name: string | null;
  expiry_date: string | null;
  manual_override: boolean;
  last_checked_at: string | null;
};

const BATCH_SIZE = 50;
const LEASE_SECONDS = 900;
const SSL_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
): Promise<{ processed: number; failed: number }> {
  let cursor = 0;
  let processed = 0;
  let failed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        await operation(items[index]!);
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error("Uptime endpoint check failed", {
          code: error && typeof error === "object" && "code" in error ? error.code : "check_error",
        });
      }
    }
  }));
  return { processed, failed };
}

async function queueIncidentNotifications(
  admin: ReturnType<typeof createAdminClient>,
  target: { organization_id: string; label: string },
  incidentId: string,
  eventType: "incident_opened" | "incident_recovered" | "ssl_invalid",
  now: string,
): Promise<void> {
  const { data: settings, error } = await admin
    .from("notification_settings")
    .select("email_enabled, email_recipients, telegram_enabled, telegram_chat_ids")
    .eq("organization_id", target.organization_id)
    .maybeSingle();
  if (error) throw error;
  if (!settings) return;

  const title = eventType === "incident_opened"
    ? `${target.label} is down`
    : eventType === "ssl_invalid"
      ? `${target.label} has an invalid TLS certificate`
      : `${target.label} recovered`;
  const payload: NotificationPayload = {
    organizationId: target.organization_id,
    eventType,
    severity: eventType === "incident_recovered" ? "info" : "critical",
    title,
    text: eventType === "incident_recovered"
      ? "The monitored service passed its latest check and the incident is resolved."
      : "The monitored service failed its configured health check. Review the incident in the authenticated dashboard.",
    dashboardPath: `/incidents`,
  };
  const recipients: Array<{ channel: "email" | "telegram"; reference: string }> = [];
  if (settings.email_enabled) {
    for (const reference of settings.email_recipients) recipients.push({ channel: "email", reference });
  }
  if (settings.telegram_enabled) {
    for (const reference of settings.telegram_chat_ids) recipients.push({ channel: "telegram", reference });
  }
  if (!recipients.length) return;

  const rows = recipients.map(({ channel, reference }) => ({
    organization_id: target.organization_id,
    incident_id: incidentId,
    event_type: eventType,
    channel,
    recipient_reference: reference,
    deduplication_key: `incident:${incidentId}:${eventType}:${channel}:${reference}`,
    payload,
    status: "queued",
    retryable: true,
    scheduled_at: now,
    next_attempt_at: now,
  }));
  const { error: insertError } = await admin
    .from("notifications")
    .upsert(rows, { onConflict: "organization_id,deduplication_key", ignoreDuplicates: true });
  if (insertError) throw insertError;
}

async function checkEndpoint(
  admin: ReturnType<typeof createAdminClient>,
  endpoint: Endpoint,
  now: Date,
): Promise<void> {
  let success = false;
  let httpStatus: number | null = null;
  let responseTimeMs: number | null = null;
  let errorCode: string | null = null;
  let sanitizedError: string | null = null;
  let redirected = false;

  try {
    const result = await safeHttpCheck({
      url: endpoint.endpoint_url,
      timeoutMs: endpoint.timeout_seconds * 1000,
      followRedirects: endpoint.follow_redirects,
      maxRedirects: endpoint.max_redirects,
    });
    httpStatus = result.status;
    responseTimeMs = result.responseTimeMs;
    redirected = result.redirected;
    success = isExpectedStatus(result.status, endpoint.expected_status_codes);
    if (!success) {
      errorCode = "unexpected_status";
      sanitizedError = `Endpoint returned unexpected HTTP status ${result.status}`;
    }
  } catch (error) {
    errorCode = error instanceof SsrfError ? error.code : "worker_error";
    sanitizedError = error instanceof SsrfError
      ? error.message
      : "The monitoring worker could not complete the check";
  }

  const checkedAt = now.toISOString();
  const isMonitorError = !success
    && classifyWorkerVsSiteFailure(errorCode) === "monitor";
  const nextFailures = success || isMonitorError ? 0 : endpoint.consecutive_failures + 1;
  const { error: resultError } = await admin.from("check_results").insert({
    organization_id: endpoint.organization_id,
    endpoint_id: endpoint.id,
    check_type: "http",
    checked_at: checkedAt,
    success,
    http_status: httpStatus,
    response_time_ms: responseTimeMs,
    error_code: errorCode,
    sanitized_error_message: sanitizedError,
    metadata: { redirected },
  });
  if (resultError) throw resultError;

  const { error: endpointError } = await admin
    .from("monitoring_endpoints")
    .update({
      last_checked_at: checkedAt,
      ...(success ? { last_success_at: checkedAt, consecutive_failures: 0 } : {
        last_failure_at: checkedAt,
        consecutive_failures: nextFailures,
      }),
    })
    .eq("id", endpoint.id)
    .eq("organization_id", endpoint.organization_id);
  if (endpointError) throw endpointError;

  const { data: activeIncident, error: incidentError } = await admin
    .from("incidents")
    .select("id, occurrence_count")
    .eq("organization_id", endpoint.organization_id)
    .eq("endpoint_id", endpoint.id)
    .eq("incident_type", "outage")
    .in("status", ["open", "acknowledged", "investigating"])
    .maybeSingle();
  if (incidentError) throw incidentError;

  if (!success && !isMonitorError && nextFailures >= endpoint.consecutive_failure_threshold) {
    if (activeIncident) {
      const { error: updateError } = await admin
        .from("incidents")
        .update({
          last_observed_at: checkedAt,
          occurrence_count: activeIncident.occurrence_count + 1,
        })
        .eq("id", activeIncident.id);
      if (updateError) throw updateError;
      return;
    }
    const { data: incident, error: insertError } = await admin
      .from("incidents")
      .insert({
        organization_id: endpoint.organization_id,
        website_id: endpoint.website_id,
        endpoint_id: endpoint.id,
        incident_type: "outage",
        severity: "critical",
        status: "open",
        started_at: checkedAt,
        last_observed_at: checkedAt,
        occurrence_count: 1,
        summary: `Website endpoint is unavailable${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
      })
      .select("id")
      .maybeSingle();
    if (insertError?.code === "23505") return;
    if (insertError) throw insertError;
    if (incident) {
      await queueIncidentNotifications(admin, {
        organization_id: endpoint.organization_id,
        label: new URL(endpoint.endpoint_url).hostname,
      }, incident.id, "incident_opened", checkedAt);
    }
  } else if (success && activeIncident) {
    const { error: resolveError } = await admin
      .from("incidents")
      .update({ status: "resolved", resolved_at: checkedAt, last_observed_at: checkedAt })
      .eq("id", activeIncident.id);
    if (resolveError) throw resolveError;
    await queueIncidentNotifications(admin, {
      organization_id: endpoint.organization_id,
      label: new URL(endpoint.endpoint_url).hostname,
    }, activeIncident.id, "incident_recovered", checkedAt);
  }
}

async function checkCertificateAsset(
  admin: ReturnType<typeof createAdminClient>,
  asset: CertificateAsset,
  now: Date,
): Promise<void> {
  if (!asset.hostname) return;
  const startedAt = Date.now();
  const inspection: CertificateInspection = await inspectCertificate({
    hostname: asset.hostname,
    now,
  });
  const checkedAt = now.toISOString();
  const { error: resultError } = await admin.from("check_results").insert({
    organization_id: asset.organization_id,
    asset_id: asset.id,
    check_type: "ssl",
    checked_at: checkedAt,
    success: inspection.success,
    response_time_ms: Date.now() - startedAt,
    certificate_not_after: inspection.hostnameMatches ? inspection.validTo : null,
    error_code: inspection.errorCode,
    sanitized_error_message: inspection.sanitizedError,
    metadata: {
      handshake_ok: inspection.handshakeOk,
      authorized: inspection.authorized,
      hostname_matches: inspection.hostnameMatches,
      valid_from: inspection.hostnameMatches ? inspection.validFrom : null,
      days_remaining: inspection.daysRemaining,
    },
  });
  if (resultError) throw resultError;

  const observedExpiry = inspection.authorized && inspection.hostnameMatches && inspection.validTo
    ? inspection.validTo.slice(0, 10)
    : null;
  const { error: assetError } = await admin
    .from("assets")
    .update({
      last_checked_at: checkedAt,
      last_check_error: inspection.sanitizedError,
      ...(inspection.authorized && inspection.hostnameMatches
        ? { last_verified_at: checkedAt }
        : {}),
      ...(!asset.manual_override && observedExpiry
        ? {
            expiry_date: observedExpiry,
            date_source: "certificate_inspection",
            date_confidence: "high",
          }
        : {}),
    })
    .eq("id", asset.id)
    .eq("organization_id", asset.organization_id);
  if (assetError) throw assetError;

  const { data: activeIncident, error: incidentError } = await admin
    .from("incidents")
    .select("id, occurrence_count")
    .eq("organization_id", asset.organization_id)
    .eq("asset_id", asset.id)
    .eq("incident_type", "ssl_invalid")
    .in("status", ["open", "acknowledged", "investigating"])
    .maybeSingle();
  if (incidentError) throw incidentError;

  const confirmedInvalid = [
    "expired",
    "hostname_mismatch",
    "not_yet_valid",
    "untrusted",
    "CERT_HAS_EXPIRED",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
  ].includes(inspection.errorCode ?? "");
  const label = asset.service_name ?? asset.hostname;
  if (confirmedInvalid) {
    if (activeIncident) {
      const { error } = await admin
        .from("incidents")
        .update({
          last_observed_at: checkedAt,
          occurrence_count: activeIncident.occurrence_count + 1,
        })
        .eq("id", activeIncident.id);
      if (error) throw error;
      return;
    }
    const { data: incident, error } = await admin
      .from("incidents")
      .insert({
        organization_id: asset.organization_id,
        website_id: asset.website_id,
        asset_id: asset.id,
        incident_type: "ssl_invalid",
        severity: "critical",
        status: "open",
        started_at: checkedAt,
        last_observed_at: checkedAt,
        occurrence_count: 1,
        summary: `TLS certificate requires attention for ${label}`,
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (incident) {
      await queueIncidentNotifications(admin, {
        organization_id: asset.organization_id,
        label,
      }, incident.id, "ssl_invalid", checkedAt);
    }
  } else if (inspection.success && activeIncident) {
    const { error } = await admin
      .from("incidents")
      .update({ status: "resolved", resolved_at: checkedAt, last_observed_at: checkedAt })
      .eq("id", activeIncident.id);
    if (error) throw error;
    await queueIncidentNotifications(admin, {
      organization_id: asset.organization_id,
      label,
    }, activeIncident.id, "incident_recovered", checkedAt);
  }
}

export async function runUptimeBatch(options: {
  workerId?: string;
  now?: Date;
  concurrency?: number;
} = {}): Promise<{ processed: number; failed: number; skipped: boolean }> {
  const admin = createAdminClient();
  const workerId = options.workerId ?? process.env.WORKER_ID ?? `worker-${randomUUID()}`;
  const concurrency = options.concurrency ?? boundedInteger("WORKER_CONCURRENCY", 5, 1, 20);
  const { data: acquired, error: leaseError } = await admin.rpc("try_acquire_job_lease", {
    p_job_name: "uptime_check",
    p_locked_by: workerId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (leaseError) throw leaseError;
  if (!acquired) return { processed: 0, failed: 0, skipped: true };

  const started = Date.now();
  let runId: string | null = null;
  let failed = 0;
  let processed = 0;
  try {
    const { data: run, error: runError } = await admin
      .from("job_runs")
      .insert({ job_name: "uptime_check" })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id;

    const now = options.now ?? new Date();
    const staleBefore = new Date(now.getTime() - 60_000).toISOString();
    const { data, error } = await admin
      .from("monitoring_endpoints")
      .select("id, organization_id, website_id, endpoint_url, expected_status_codes, check_interval_seconds, timeout_seconds, follow_redirects, max_redirects, consecutive_failure_threshold, consecutive_failures, last_checked_at")
      .eq("enabled", true)
      .or(`last_checked_at.is.null,last_checked_at.lte.${staleBefore}`)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);
    if (error) throw error;

    const due = ((data ?? []) as Endpoint[]).filter((endpoint) =>
      !endpoint.last_checked_at
      || now.getTime() - new Date(endpoint.last_checked_at).getTime() >= endpoint.check_interval_seconds * 1000,
    );
    const outcome = await runWithConcurrency(due, concurrency, (endpoint) => checkEndpoint(admin, endpoint, now));
    processed = outcome.processed;
    failed = outcome.failed;
    const { error: finishError } = await admin
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        success: failed === 0,
        processed_count: processed,
        error_count: failed,
        duration_ms: Date.now() - started,
      })
      .eq("id", runId);
    if (finishError) throw finishError;
    return { processed, failed, skipped: false };
  } catch (error) {
    console.error("Uptime worker batch failed", {
      code: error && typeof error === "object" && "code" in error ? error.code : "job_error",
    });
    if (runId) {
      const { error: updateError } = await admin
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          success: false,
          processed_count: processed,
          error_count: Math.max(failed, 1),
          duration_ms: Date.now() - started,
          sanitized_error: "Uptime worker batch failed",
        })
        .eq("id", runId);
      if (updateError) console.error("Could not record uptime worker failure", { code: updateError.code });
    }
    throw error;
  } finally {
    const { error } = await admin.rpc("release_job_lease", {
      p_job_name: "uptime_check",
      p_locked_by: workerId,
    });
    if (error) console.error("Could not release uptime worker lease", { code: error.code });
  }
}

export async function runSslBatch(options: {
  workerId?: string;
  now?: Date;
  concurrency?: number;
  intervalMs?: number;
} = {}): Promise<{ processed: number; failed: number; skipped: boolean }> {
  const admin = createAdminClient();
  const workerId = options.workerId ?? process.env.WORKER_ID ?? `worker-${randomUUID()}`;
  const concurrency = options.concurrency ?? boundedInteger("WORKER_CONCURRENCY", 5, 1, 20);
  const lease = await admin.rpc("try_acquire_job_lease", {
    p_job_name: "ssl_check",
    p_locked_by: workerId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (lease.error) throw lease.error;
  if (!lease.data) return { processed: 0, failed: 0, skipped: true };

  const started = Date.now();
  let runId: string | null = null;
  let processed = 0;
  let failed = 0;
  try {
    const { data: run, error: runError } = await admin
      .from("job_runs")
      .insert({ job_name: "ssl_check" })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id;

    const now = options.now ?? new Date();
    const intervalMs = options.intervalMs ?? boundedInteger(
      "SSL_CHECK_INTERVAL_SECONDS",
      SSL_CHECK_INTERVAL_MS / 1000,
      3600,
      86_400,
    ) * 1000;
    const staleBefore = new Date(now.getTime() - Math.min(intervalMs, 60_000)).toISOString();
    const { data, error } = await admin
      .from("assets")
      .select("id, organization_id, website_id, hostname, service_name, expiry_date, manual_override, last_checked_at")
      .eq("active", true)
      .eq("asset_type", "ssl_certificate")
      .not("hostname", "is", null)
      .or(`last_checked_at.is.null,last_checked_at.lte.${staleBefore}`)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);
    if (error) throw error;
    const due = ((data ?? []) as CertificateAsset[]).filter((asset) =>
      !asset.last_checked_at || now.getTime() - new Date(asset.last_checked_at).getTime() >= intervalMs,
    );
    const result = await runWithConcurrency(due, concurrency, (asset) =>
      checkCertificateAsset(admin, asset, now),
    );
    processed = result.processed;
    failed = result.failed;
    const { error: finishError } = await admin
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        success: failed === 0,
        processed_count: processed,
        error_count: failed,
        duration_ms: Date.now() - started,
      })
      .eq("id", runId);
    if (finishError) throw finishError;
    return { processed, failed, skipped: false };
  } catch (error) {
    console.error("Certificate worker batch failed", {
      code: error && typeof error === "object" && "code" in error ? error.code : "job_error",
    });
    if (runId) {
      const { error: updateError } = await admin
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          success: false,
          processed_count: processed,
          error_count: Math.max(failed, 1),
          duration_ms: Date.now() - started,
          sanitized_error: "Certificate worker batch failed",
        })
        .eq("id", runId);
      if (updateError) console.error("Could not record certificate job failure", { code: updateError.code });
    }
    throw error;
  } finally {
    const { error } = await admin.rpc("release_job_lease", {
      p_job_name: "ssl_check",
      p_locked_by: workerId,
    });
    if (error) console.error("Could not release certificate worker lease", { code: error.code });
  }
}

async function main() {
  const intervalSeconds = boundedInteger("WORKER_POLL_INTERVAL_SECONDS", 30, 5, 3600);
  const concurrency = boundedInteger("WORKER_CONCURRENCY", 5, 1, 20);
  const workerId = process.env.WORKER_ID ?? `uptime-${randomUUID()}`;
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  console.info("Uptime worker started", { workerId, intervalSeconds, concurrency });

  while (!stopping) {
    try {
      const result = await runUptimeBatch({ workerId, concurrency });
      console.info("Uptime worker batch complete", result);
      const certificates = await runSslBatch({ workerId, concurrency });
      console.info("Certificate worker batch complete", certificates);
    } catch (error) {
      console.error("Uptime worker iteration failed", {
        code: error && typeof error === "object" && "code" in error ? error.code : "worker_error",
      });
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
