import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptConnectorSecret, sha256, newConnectorSecret } from "@/lib/wordpress-connector/security";

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 4096) return NextResponse.json({ error: "invalid_request" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof (body as { pairing_code?: unknown }).pairing_code !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const code = (body as { pairing_code: string }).pairing_code;
  if (code.length < 20 || code.length > 100) return NextResponse.json({ error: "invalid_pairing_code" }, { status: 400 });
  const admin = createAdminClient();
  const { data: pair, error: lookupError } = await admin.from("wordpress_connector_pairing_codes")
    .select("id, organization_id, website_id, expires_at, consumed_at")
    .eq("code_hash", sha256(code)).maybeSingle();
  if (lookupError) {
    console.error("WordPress connector pairing code lookup failed", { code: lookupError.code });
    return NextResponse.json({ error: "pairing_unavailable" }, { status: 503 });
  }
  if (!pair || pair.consumed_at || new Date(pair.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "invalid_or_expired_pairing_code" }, { status: 401 });
  }
  const { data: website, error: websiteError } = await admin.from("websites").select("id, organization_id, platform, active, client:clients!inner(active)")
    .eq("id", pair.website_id).eq("organization_id", pair.organization_id).maybeSingle();
  if (websiteError) {
    console.error("WordPress connector paired website lookup failed", { code: websiteError.code });
    return NextResponse.json({ error: "pairing_unavailable" }, { status: 503 });
  }
  const client = Array.isArray(website?.client) ? website.client[0] : website?.client;
  if (!website?.active || !client?.active || website.platform !== "wordpress") return NextResponse.json({ error: "website_unavailable" }, { status: 409 });
  const consumedAt = new Date().toISOString();
  const consumed = await admin.from("wordpress_connector_pairing_codes").update({ consumed_at: consumedAt })
    .eq("id", pair.id).is("consumed_at", null).gt("expires_at", consumedAt).select("id").maybeSingle();
  if (consumed.error) {
    console.error("WordPress connector pairing code consumption failed", { code: consumed.error.code });
    return NextResponse.json({ error: "pairing_unavailable" }, { status: 503 });
  }
  if (!consumed.data) return NextResponse.json({ error: "pairing_code_already_used" }, { status: 409 });

  const secret = newConnectorSecret();
  let secretCiphertext: string;
  try { secretCiphertext = encryptConnectorSecret(secret); } catch {
    console.error("WordPress connector secret encryption is unavailable");
    return NextResponse.json({ error: "pairing_unavailable" }, { status: 503 });
  }
  const { data: existing, error: existingError } = await admin.from("wordpress_connectors").select("id")
    .eq("website_id", website.id).maybeSingle();
  if (existingError) {
    console.error("WordPress connector lookup failed", { code: existingError.code });
    return NextResponse.json({ error: "pairing_unavailable" }, { status: 503 });
  }
  const result = existing
    ? await admin.from("wordpress_connectors").update({ organization_id: website.organization_id, status: "active", paired_at: consumedAt, last_report_at: null, last_error_code: null, revoked_at: null }).eq("id", existing.id).select("id").single()
    : await admin.from("wordpress_connectors").insert({ organization_id: website.organization_id, website_id: website.id }).select("id").single();
  if (result.error || !result.data) {
    console.error("WordPress connector pairing failed", { code: result.error?.code });
    return NextResponse.json({ error: "pairing_failed" }, { status: 500 });
  }
  const credential = await admin.from("wordpress_connector_credentials").upsert({ connector_id: result.data.id, secret_ciphertext: secretCiphertext, updated_at: consumedAt });
  if (credential.error) {
    await admin.from("wordpress_connectors").update({ status: "revoked", revoked_at: consumedAt }).eq("id", result.data.id);
    return NextResponse.json({ error: "pairing_failed" }, { status: 500 });
  }
  await admin.from("audit_logs").insert({ organization_id: website.organization_id, action: "wordpress_connector.paired", entity_type: "website", entity_id: website.id, metadata: { connector_id: result.data.id } });
  return NextResponse.json({ connection_id: result.data.id, secret, report_url: "/api/connectors/wordpress/report", schema_version: 1 }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
