"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { appBaseUrl } from "@/lib/env";
import { ensureDefaultWorkspaceMembership } from "@/lib/auth/workspace-membership";
import { classifyPasswordResetError } from "@/lib/auth/password-reset-error";
import { classifySignupError } from "@/lib/auth/signup-error";
import { createClient } from "@/lib/supabase/server";

const signupSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12),
});

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?error=credentials");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Sign-in failed", { code: error.code ?? "auth_error" });
    redirect("/login?error=credentials");
  }
  if (!(await ensureDefaultWorkspaceMembership(supabase))) {
    redirect("/setup?error=workspace");
  }
  redirect("/");
}

export async function signUp(formData: FormData): Promise<void> {
  const parsed = signupSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    redirect("/signup?error=invalid");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${appBaseUrl()}/auth/callback?next=%2F`,
    },
  });
  if (error) {
    console.error("Sign-up failed", {
      code: error.code ?? "auth_error",
      status: error.status,
    });
    redirect(`/signup?error=${classifySignupError(error)}`);
  }
  if (data.session) {
    if (!(await ensureDefaultWorkspaceMembership(supabase))) {
      redirect("/setup?error=workspace");
    }
    redirect("/");
  }
  redirect("/signup?sent=1");
}

export async function requestPasswordReset(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !z.string().email().max(254).safeParse(email).success) {
    redirect("/forgot-password?error=invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appBaseUrl()}/auth/callback?next=%2Freset-password`,
  });
  if (error) {
    console.error("Password reset request failed", {
      code: error.code ?? "auth_error",
      status: error.status,
    });
    redirect(`/forgot-password?error=${classifyPasswordResetError(error)}`);
  }
  redirect("/forgot-password?sent=1");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Sign-out failed", { code: error.code ?? "auth_error" });
    redirect("/?error=signout");
  }
  redirect("/login");
}
