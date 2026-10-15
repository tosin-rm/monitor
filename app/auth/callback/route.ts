import { NextResponse, type NextRequest } from "next/server";
import { appBaseUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  const base = new URL(appBaseUrl());
  const target = new URL(value, base);
  if (target.origin !== base.origin) return "/";
  return `${target.pathname}${target.search}${target.hash}`;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const baseUrl = appBaseUrl();

  const supabase = await createClient();
  const authResult = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type === "invite"
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" })
      : null;
  if (!authResult) {
    return NextResponse.redirect(new URL("/login?error=invite", baseUrl));
  }
  const { error } = authResult;
  if (error) {
    console.error("Auth callback failed", { code: error.code ?? "auth_error" });
    return NextResponse.redirect(new URL("/login?error=invite", baseUrl));
  }
  return NextResponse.redirect(new URL(next, baseUrl));
}
