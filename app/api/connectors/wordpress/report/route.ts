import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptConnectorSecret, normalizePluginInventory, reportSchema, reportSecurityTimestamps, validHmac } from "@/lib/wordpress-connector/security";
import { isConnectorReplayError } from "@/lib/wordpress-connector/status";

const MAX_BODY_BYTES = 256 * 1024;

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; }
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const connectionId = request.headers.get("x-monitor-connection") ?? "";
  const timestamp = request.headers.get("x-monitor-timestamp") ?? "";
  const requestId = request.headers.get("x-monitor-request-id") ?? "";
  const signature = request.headers.get("x-monitor-signature") ?? "";
  if (!/^[0-9]{10}$/.test(timestamp) || !/^[0-9a-f-]{36}$/i.test(requestId) || !/^[0-9a-f-]{36}$/i.test(connectionId)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const timestampMs = Number(timestamp) * 1000;
  if (Math.abs(Date.now() - timestampMs) > 5 * 60_000) return NextResponse.json({ error: "stale_request" }, { status: 401 });
  const rawBody = await readBoundedBody(request);
  if (rawBody === null) return NextResponse.json({ error: "payload_too_large_or_invalid_encoding" }, { status: 413 });
  let decoded: unknown;
  try { decoded = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "invalid_payload" }, { status: 400 }); }
  const parsed = reportSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.request_id.toLowerCase() !== requestId.toLowerCase()) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const collected = new Date(parsed.data.collected_at).getTime();
  if (collected > Date.now() + 5 * 60_000 || collected < Date.now() - 7 * 24 * 60 * 60_000) {
    return NextResponse.json({ error: "invalid_collected_at" }, { status: 400 });
  }
  const securityTimes = reportSecurityTimestamps(parsed.data)
    .filter((value): value is string => Boolean(value)).map((value) => new Date(value).getTime());
  if (securityTimes.some((value) => value > Date.now() + 5 * 60_000)) {
    return NextResponse.json({ error: "invalid_security_timestamp" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: connector, error } = await admin.from("wordpress_connectors")
    .select("id, organization_id, website_id, status")
    .eq("id", connectionId).eq("status", "active").maybeSingle();
  if (error || !connector) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: credential, error: credentialError } = await admin.from("wordpress_connector_credentials")
    .select("secret_ciphertext").eq("connector_id", connector.id).maybeSingle();
  if (credentialError || !credential) return NextResponse.json({ error: "connection_unavailable" }, { status: 503 });
  let secret: string;
  try { secret = decryptConnectorSecret(credential.secret_ciphertext); } catch {
    console.error("WordPress connector secret could not be decrypted", { connectorId: connectionId });
    return NextResponse.json({ error: "connection_unavailable" }, { status: 503 });
  }
  if (!validHmac(secret, timestamp, requestId, rawBody, signature)) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  const { data: website } = await admin.from("websites").select("id, client:clients!inner(active)")
    .eq("id", connector.website_id).eq("organization_id", connector.organization_id)
    .eq("active", true).eq("client.active", true).eq("platform", "wordpress").maybeSingle();
  if (!website) return NextResponse.json({ error: "website_unavailable" }, { status: 409 });

  const nonceCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const reportCutoff = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();
  const [noncePrune, reportPrune] = await Promise.all([
    admin.from("wordpress_connector_nonces").delete().lt("received_at", nonceCutoff),
    admin.from("wordpress_connector_reports").delete().lt("received_at", reportCutoff),
  ]);
  if (noncePrune.error || reportPrune.error) {
    console.error("WordPress connector retention cleanup failed", { nonceCode: noncePrune.error?.code, reportCode: reportPrune.error?.code });
  }

  const rate = await admin.rpc("consume_wordpress_connector_rate_limit", { p_connector_id: connector.id });
  if (rate.error) {
    console.error("WordPress connector rate limit check failed", { code: rate.error.code });
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
  }
  if (rate.data !== true) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  const report = parsed.data;
  const saved = await admin.rpc("save_wordpress_connector_report_v2", {
    p_connector_id: connector.id,
    p_request_id: report.request_id,
    p_schema_version: report.schema_version,
    p_collected_at: report.collected_at,
    p_wordpress_version: report.wordpress_version,
    p_plugins: normalizePluginInventory(report.plugins),
    p_spam_comment_count: report.spam_comment_count,
    p_security_report: report.security ?? {},
  });
  if (saved.error) {
    if (isConnectorReplayError(saved.error.code)) return NextResponse.json({ error: "duplicate_request" }, { status: 409 });
    if (saved.error.code === "P0002") return NextResponse.json({ error: "website_unavailable" }, { status: 409 });
    console.error("WordPress connector report save failed", { code: saved.error.code, connectorId: connectionId });
    await admin.from("wordpress_connectors").update({ last_error_code: "report_persist_failed" }).eq("id", connector.id).eq("status", "active");
    return NextResponse.json({ error: "report_not_saved" }, { status: 503 });
  }
  if (report.security) {
    const { error: auditError } = await admin.from("audit_logs").insert({
      organization_id: connector.organization_id,
      action: "wordpress_connector.security_report_received",
      entity_type: "website",
      entity_id: connector.website_id,
      metadata: {
        connector_id: connector.id,
        security_schema: "vulnerability_check" in report.security ? "legacy" : "1.1",
        vulnerability_status: "vulnerability_check" in report.security ? report.security.vulnerability_check.status : report.security.vulnerability_data.status,
        vulnerability_finding_count: "vulnerability_check" in report.security ? report.security.vulnerability_check.advisories.length : report.security.vulnerability_data.findings.length,
        scan_status: "vulnerability_check" in report.security ? report.security.activity_scan.status : report.security.scan_status,
        suspicious_activity_status: "vulnerability_check" in report.security ? report.security.activity_scan.status : report.security.suspicious_activity.status,
        finding_count: "vulnerability_check" in report.security ? report.security.activity_scan.findings.length : report.security.suspicious_activity.findings.length,
      },
    });
    if (auditError) console.error("WordPress connector security audit write failed", { code: auditError.code, connectorId: connector.id });
  }
  return NextResponse.json({ accepted: true, report_id: saved.data }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
