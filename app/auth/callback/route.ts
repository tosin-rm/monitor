import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { classifyAuthCallbackError } from "@/lib/auth/callback-error";
import { appBaseUrl } from "@/lib/env";
import { ensureDefaultWorkspaceMembership } from "@/lib/auth/workspace-membership";
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
  const providerErrorCode =
    request.nextUrl.searchParams.get("error_code") ??
    request.nextUrl.searchParams.get("error");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const isInvitation = type === "invite" || next === "/set-password";
  const baseUrl = appBaseUrl();

  const supabase = await createClient();
  const authResult = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && (type === "invite" || type === "signup" || type === "recovery")
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })
      : null;
  const isPasswordRecovery = type === "recovery" || (Boolean(code) && next === "/reset-password");
  if (!authResult) {
    const destination = isPasswordRecovery
      ? "/forgot-password?error=link"
      : isInvitation
        ? `/login?error=${providerErrorCode || code || tokenHash ? `invite-${classifyAuthCallbackError(providerErrorCode)}` : "invite-configuration"}`
        : `/login?error=${type === "signup" ? "signup" : "invite"}`;
    if (isInvitation) {
      console.error("Invitation callback did not contain a usable verification token", {
        hasCode: Boolean(code),
        hasTokenHash: Boolean(tokenHash),
        providerError: classifyAuthCallbackError(providerErrorCode),
      });
    }
    return NextResponse.redirect(new URL(destination, baseUrl));
  }
  const { error } = authResult;
  if (error) {
    const failure = classifyAuthCallbackError(error.code ?? error.message);
    console.error("Auth callback failed", {
      code: error.code ?? "auth_error",
      flow: isPasswordRecovery ? "recovery" : isInvitation ? "invite" : type ?? "code",
    });
    const destination = isPasswordRecovery
      ? "/forgot-password?error=link"
      : isInvitation
        ? `/login?error=invite-${failure}`
        : `/login?error=${type === "signup" ? "signup" : "invite"}`;
    return NextResponse.redirect(new URL(destination, baseUrl));
  }
  if (isPasswordRecovery) {
    return NextResponse.redirect(new URL("/reset-password", baseUrl));
  }
  if (!(await ensureDefaultWorkspaceMembership(supabase))) {
    return NextResponse.redirect(new URL("/setup?error=workspace", baseUrl));
  }
  return NextResponse.redirect(new URL(next, baseUrl));
}
