import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const updateSchema = z.object({
  message: z.object({
    text: z.string().max(4096).optional(),
    chat: z.object({
      id: z.union([z.number().int().safe(), z.string().max(32)]),
    }),
  }).optional(),
});

function secretMatches(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

async function reply(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    console.error("Telegram webhook reply failed");
  }
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  if (!secretMatches(webhookSecret, request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 65_536) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > 65_536) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const parsed = updateSchema.safeParse(parsedBody);
  if (!parsed.success || !parsed.data.message?.text) return NextResponse.json({ ok: true });

  const command = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{24,64})$/.exec(parsed.data.message.text.trim());
  if (!command?.[1]) return NextResponse.json({ ok: true });

  const codeHash = createHash("sha256").update(command[1]).digest("hex");
  const chatId = String(parsed.data.message.chat.id);
  const admin = createAdminClient();
  const { error } = await admin.rpc("consume_telegram_link_challenge", {
    p_code_hash: codeHash,
    p_chat_id: chatId,
  });
  if (error) {
    console.error("Telegram chat linking failed", { code: error.code });
    await reply(chatId, "Monitor could not link this chat. The code may be expired or already used; ask an administrator for a new one.");
    return NextResponse.json({ ok: true });
  }

  await reply(chatId, "This Telegram chat is now linked to your Monitor team notifications.");
  return NextResponse.json({ ok: true });
}
