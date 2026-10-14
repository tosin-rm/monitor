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
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=invite", appBaseUrl()));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Auth callback failed", { code: error.code ?? "auth_error" });
    return NextResponse.redirect(new URL("/login?error=invite", appBaseUrl()));
  }
  return NextResponse.redirect(new URL(next, appBaseUrl()));
}
