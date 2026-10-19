"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const passwordSchema = z.object({
  password: z.string().min(12),
  confirmation: z.string(),
}).refine((value) => value.password === value.confirmation);

export async function updatePassword(formData: FormData): Promise<void> {
  const parsed = passwordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmation: String(formData.get("confirmation") ?? ""),
  });
  if (!parsed.success) redirect("/reset-password?error=invalid");

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/forgot-password?error=link");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("Password reset update failed", { code: error.code ?? "auth_error" });
    redirect("/reset-password?error=update");
  }

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    console.error("Password reset sign-out failed", { code: signOutError.code ?? "auth_error" });
    redirect("/");
  }
  redirect("/login?success=password-reset");
}
