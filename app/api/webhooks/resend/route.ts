import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > 65_536) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let event;
  try {
    const headers = {
      id: request.headers.get("svix-id") ?? "",
      timestamp: request.headers.get("svix-timestamp") ?? "",
      signature: request.headers.get("svix-signature") ?? "",
    };
    if (!headers.id || !headers.timestamp || !headers.signature) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }
    event = new Resend().webhooks.verify({
      payload: rawBody,
      headers,
      webhookSecret: secret,
    });
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  if (!event.type.startsWith("email.") || !("email_id" in event.data)) {
    return NextResponse.json({ ok: true });
  }

  let update: {
    status?: "delivered" | "failed";
    retryable?: boolean;
    delivered_at?: string | null;
    sanitized_error?: string | null;
  } | null = null;
  if (event.type === "email.delivered") {
    update = {
      status: "delivered",
      retryable: false,
      delivered_at: event.created_at,
      sanitized_error: null,
    };
  } else if (event.type === "email.bounced") {
    update = {
      status: "failed",
      retryable: false,
      sanitized_error: "Email was not delivered; provider reported a bounce",
    };
  } else if (event.type === "email.failed" || event.type === "email.suppressed") {
    update = {
      status: "failed",
      retryable: false,
      sanitized_error: "Email was not delivered by the provider",
    };
  } else if (event.type === "email.delivery_delayed") {
    update = { sanitized_error: "Provider reports delivery is delayed; awaiting a final status" };
  } else if (event.type === "email.complained") {
    update = {
      status: "delivered",
      retryable: false,
      delivered_at: event.created_at,
      sanitized_error: "Recipient reported this message as spam",
    };
  }
  if (!update) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const query = admin
    .from("notifications")
    .update(update)
    .eq("channel", "email")
    .eq("provider_message_id", event.data.email_id)
    .eq("status", "accepted");
  const { error } = await query;
  if (error) {
    console.error("Resend delivery webhook update failed", { code: error.code });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
