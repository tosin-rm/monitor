"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function setPassword(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 12 || password !== confirmation) {
    redirect("/set-password?error=invalid");
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login?error=invite");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("Password setup failed", { code: error.code ?? "auth_error" });
    redirect("/set-password?error=update");
  }
  redirect("/");
}
