import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptConnectorSecret, validHmac } from "@/lib/wordpress-connector/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 4096) return NextResponse.json({ error: "invalid_request" }, { status: 413 });
  const connectionId = request.headers.get("x-monitor-connection") ?? "";
  const timestamp = request.headers.get("x-monitor-timestamp") ?? "";
  const requestId = request.headers.get("x-monitor-request-id") ?? "";
  const signature = request.headers.get("x-monitor-signature") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(connectionId) || !/^[0-9]{10}$/.test(timestamp) || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 5 * 60_000) return NextResponse.json({ error: "stale_request" }, { status: 401 });
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || (body as { connection_id?: unknown }).connection_id !== connectionId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: connector } = await admin.from("wordpress_connectors").select("id, status").eq("id", connectionId).maybeSingle();
  if (!connector || connector.status !== "active") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: credential } = await admin.from("wordpress_connector_credentials").select("secret_ciphertext").eq("connector_id", connectionId).maybeSingle();
  if (!credential) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let secret: string;
  try { secret = decryptConnectorSecret(credential.secret_ciphertext); } catch {
    return NextResponse.json({ error: "connection_unavailable" }, { status: 503 });
  }
  if (!validHmac(secret, timestamp, requestId, rawBody, signature)) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  const revokedAt = new Date().toISOString();
  const { error } = await admin.from("wordpress_connectors").update({ status: "revoked", revoked_at: revokedAt }).eq("id", connectionId).eq("status", "active");
  if (error) return NextResponse.json({ error: "revoke_failed" }, { status: 503 });
  const removed = await admin.from("wordpress_connector_credentials").delete().eq("connector_id", connectionId);
  if (removed.error) return NextResponse.json({ error: "revoke_failed" }, { status: 503 });
  return NextResponse.json({ revoked: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
